// @ts-nocheck
import Tracker from './Tracker';
import EJSON from 'ejson';
import Data from './Data';
import Random from '../lib/Random';
import call from './Call';
import { hasOwn, isPlainObject } from '../lib/utils';

/**
 * @private
 * @type {object}
 */
const observers: Record<string, any[]> = Object.create(null);
/**
 * @private
 * @type {object}
 */
const observersByComp: Record<string, Record<string, any>> = Object.create(null);
/**
 * Get the list of callbacks for changes on a collection
 * @param {string} type - Type of change happening.
 * @param {string} collection - Collection it has happened on
 * @param {string} newDocument - New value of item in the collection
 */
export function getObservers(
  type: 'added' | 'changed' | 'removed',
  collection: string,
  newDocument: any
) {
  let observersRet: Array<(...args: any[]) => void> = [];
  if (observers[collection]) {
    observers[collection].forEach(({ cursor, callbacks }) => {
      const cb = callbacks[type];
      if (!cb) return;

      // For removals, always notify the dedicated 'removed' callback
      // If there is no selector, notify unconditionally
      if (type === 'removed' || !cursor._selector) {
        observersRet.push(cb);
        return;
      }

      // Otherwise notify only if the new/changed document matches the selector
      const matches = !!Data.db[collection].findOne({
        $and: [{ _id: newDocument._id }, cursor._selector],
      });
      if (matches) observersRet.push(cb);
    });
  }
  // Find the observers related to the specific query
  if (observersByComp[collection] && !(collection in {})) {
    let keys = Object.keys(observersByComp[collection]);
    for (let i = 0; i < keys.length; i++) {
      observersByComp[collection][keys[i]].callbacks.forEach(
        ({ cursor, callback }) => {
          let findRes = cursor._selector
            ? Data.db[collection].findOne({
                $and: [{ _id: newDocument?._id }, cursor._selector],
              })
            : true;

          if (findRes) {
            observersRet.push(callback);
          }
        }
      );
    }
  }
  return observersRet;
}

/** @private */
const _registerObserver = (collection: string, cursor: any, callbacks: any) => {
  observers[collection] = observers[collection] || [];
  const entry = { cursor, callbacks };
  observers[collection].push(entry);
  return {
    stop() {
      const list = observers[collection];
      if (!list) return;
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) {
        delete observers[collection];
      }
    },
  };
};

/**
 * Represents a Mongo.Cursor, usually returned by Collection.find().
 *
 * @see https://docs.meteor.com/api/collections.html#mongo_cursor
 */
type MinimongoCollection<T = any> = {
  name: string;
  find(selector?: any, options?: any): T[];
  findOne(selector?: any, options?: any): T | undefined;
  get(id: string): T | undefined;
  upsert(doc: Partial<T> & { _id: string }): void;
  remove(selector: any): void;
  del(id: string): void;
};

class Cursor<T = any> {
  /**
   * Usually you don't use this directly, unless you know what you are doing.
   * @constructor
   * @param collection
   * @param docs
   * @param selector
   */
  _docs: T[];
  _collection: Collection<T>;
  _selector: any;
  constructor(collection: Collection<T>, docs: T[], selector: any) {
    this._docs = docs || [];
    this._collection = collection;
    this._selector = selector;
  }

  /**
   * Returns the number of documents that match a query.
   * This method is deprecated since MongoDB 4.0 and will soon be replaced by
   * Collection.countDocuments and Collection.estimatedDocumentCount.
   *
   * @deprecated
   * @returns {number} size of the collection
   */
  count(): number {
    return this._docs.length;
  }

  /**
   * Return all matching documents as an Array.
   * @returns {object[]}
   */
  fetch(): T[] {
    return this._transformedDocs();
  }

  /**
   * Call callback once for each matching document, sequentially and synchronously.
  * @param callback {function}
   *     Function to call. It will be called with three arguments: the document, a 0-based index, and cursor itself.
   */
  forEach(callback: (doc: T, index: number, cursor: this) => void) {
    this._transformedDocs().forEach(callback);
  }

  /**
   * Map callback over all matching documents. Returns an Array.
   * @param callback {function} Function to call. It will be called with three arguments:
   *   the document, a 0-based index, and cursor itself.
   * @returns {object[]}
   */
  map<U>(callback: (doc: T, index: number, cursor: this) => U): U[] {
    return this._transformedDocs().map(callback as any);
  }

  /**
   * Applies a transform method on the documents, if given.
   * @private
   * @private
   * @returns {object[]}
   */
  _transformedDocs(): T[] {
    return this._collection._transform
      ? (this._docs as any).map(this._collection._transform)
      : this._docs;
  }

  /**
   * Registers an observer for the given callbacks
   * @param callbacks {object}
   * @see https://docs.meteor.com/api/collections.html#Mongo-Cursor-observe
   */
  observe(callbacks: Record<'added' | 'changed' | 'removed', Function>) {
    return _registerObserver(this._collection._collection.name, this, callbacks);
  }
}

/**
 * List of all local collections, whose names
 * are defined with `null`.
 *
 */
export const localCollections: string[] = [];

/**
 * Reference implementation for a Mongo.Collection.
 * Uses Minimongo under the hood.
 * We have forked minimongo into our org, see the link below.
 *
 * @class
 * @see https://docs.meteor.com/api/collections.html
 * @see https://github.com/meteorrn/minimongo-cache
 */
export class Collection<TDoc = any> {
  /**
   * Constructor for a Collection
   * @param name {string|null}
   *     The name of the collection. If null, creates an unmanaged (unsynchronized) local collection.
   * @param options {object=}
   * @param options.transform {function=}
   *  An optional transformation function.
   *  Documents will be passed through this function before being returned from fetch or findOne,
   *  and before being passed to callbacks of observe, map, forEach, allow, and deny.
   *  Transforms are not applied for the callbacks of observeChanges or to cursors returned from publish functions.
   */
  _collection!: MinimongoCollection<TDoc>;
  _name!: string;
  _transform: ((doc: TDoc) => TDoc) | null = null;

  constructor(name: string | null, options: { transform?: (doc: TDoc) => TDoc } = {}) {
    if (name === null) {
      this.localCollection = true;
      name = Random.id();
      localCollections.push(name);
    }

    // XXX: apparently using a name that occurs in Object prototype causes
    // Data.db[name] to return the full MemoryDb implementation from Minimongo
    // instead of a collection.
    // A respective issues has been opened: https://github.com/meteorrn/minimongo-cache
    // Additionally, this is subject to prototype pollution.
    if (name in {}) {
      throw new Error(
        `Object-prototype property ${name} is not a supported Collection name`
      );
    }

    if (!Data.db[name]) Data.db.addCollection(name);

    this._collection = Data.db[name] as MinimongoCollection<TDoc>;
    this._name = name;
    this._transform = wrapTransform(options.transform as any) as any;
  }

  /**
   * Find the documents in a collection that match the selector.
   * If called in useTracker it automatically invokes a new Tracker.Computation
   * // TODO add reactive flag to options to disable reactivity for this call
   * // TODO evaluate if hint: { $natural } can be implemented for backward search
   *
   * @param selector {string|object}
   *     A query describing the documents to find
   * @param options {object=}
   * @param options.sort {object=}
   * @param options.limit {number=}
   * @param options.skip {number=}
   * @param options.fields {object=}
   * @returns {Cursor}
   */
  find(selector: string | Record<string, any>, options?: any): Cursor<TDoc> {
    let result;
    let docs: TDoc[] | undefined;

    if (typeof selector == 'string') {
      if (options) {
        docs = this._collection.findOne({ _id: selector }, options);
      } else {
        docs = this._collection.get(selector);
      }

      if (docs) docs = [docs];
    } else {
      docs = this._collection.find(selector, options);
    }
    result = new Cursor<TDoc>(
      this,
      docs || [],
      typeof selector == 'string' ? { _id: selector } : selector
    );

    // If this is being called within a use tracker
    // make the tracker computation to say if this
    // collection is changed it needs to be re-run
    if (Tracker.active && Tracker.currentComputation) {
      let id = (Tracker.currentComputation as any)._id;
      observersByComp[this._name] =
        observersByComp[this._name] || Object.create(null);
      if (!observersByComp[this._name][id]) {
        let item = {
          computation: Tracker.currentComputation,
          callbacks: [],
        };
        observersByComp[this._name][id] = item;
      }

      let item = observersByComp[this._name][id];

      item.callbacks.push({
        cursor: result,
        callback: (newVal: any, old: any) => {
          if (old && EJSON.equals(newVal, old)) {
            return;
          }

          item.computation.invalidate();
        },
      });

      Tracker.onInvalidate(() => {
        if (observersByComp[this._name][id]) {
          delete observersByComp[this._name][id];
        }
      });
    }

    return result;
  }

  /**
   *
   * @param selector
   * @param options
   * @returns {Cursor}
   */
  findOne(selector: string | Record<string, any>, options?: any): TDoc | undefined {
    let result = this.find(selector, options);

    if (result) {
      result = result.fetch()[0];
    }

    return result as any;
  }

  /**
   * Define helpers for documents. This is basically an implementation of
   * `dburles:mongo-collection-helpers`
   * @param helpers {object} dictionary of helper functions that become prototypes of the documents
   * @see https://github.com/dburles/meteor-collection-helpers
   */
  helpers(helpers: Record<string, Function>) {
    let _transform;

    if (this._transform && !this._helpers) _transform = this._transform;

    if (!this._helpers) {
      this._helpers = function Document(doc) {
        return Object.assign(this, doc);
      };
      this._transform = (doc: any) => {
        if (_transform) {
          doc = _transform(doc);
        }
        return new this._helpers(doc);
      };
    }

    Object.entries(helpers).forEach(([key, helper]) => {
      this._helpers.prototype[key] = helper;
    });
  }
}

//From Meteor core

/**
 * Wrap a transform function to return objects that have the _id field
 * of the untransformed document. This ensures that subsystems such as
 * the observe-sequence package that call `observe` can keep track of
 * the documents identities.
 *
 * - Require that it returns objects
 * - If the return value has an _id field, verify that it matches the
 *   original _id field
 * - If the return value doesn't have an _id field, add it back.
 * @private
 */
function wrapTransform<T>(transform?: (doc: T) => T) {
  if (!transform) return null;

  // No need to doubly-wrap transforms.
  if (transform.__wrappedTransform__) return transform;

  var wrapped = function (doc: any) {
    if (!hasOwn(doc, '_id')) {
      // XXX do we ever have a transform on the oplog's collection? because that
      // collection has no _id.
      throw new Error('can only transform documents with _id');
    }

    var id = doc._id;
    // XXX consider making tracker a weak dependency and checking Package.tracker here
    var transformed = Tracker.nonreactive(function () {
      return (transform as any)(doc);
    });

    if (!isPlainObject(transformed)) {
      throw new Error('transform must return object');
    }

    if (hasOwn(transformed, '_id')) {
      if (!EJSON.equals(transformed._id, id)) {
        throw new Error("transformed document can't have different _id");
      }
    } else {
      transformed._id = id;
    }
    return transformed;
  };
  (wrapped as any).__wrappedTransform__ = true;
  return wrapped as any;
}
