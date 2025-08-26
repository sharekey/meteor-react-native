import { WebSocket } from 'mock-socket';
import Mongo from '../../src/Mongo';
import { endpoint, props } from '../testHelpers';
import { expect } from 'chai';
import Data from '../../src/Data';
import DDP from '../../lib/ddp';
import Random from '../../lib/Random';
import { server } from '../hooks/mockServer';
import Tracker from '../../src/Tracker';

const Collection = Mongo.Collection;
const objectProps = props({});
const defaultProps = [
  '_collection',
  '_name',
  '_transform',
  'constructor',
  'find',
  'findOne',
  'helpers',
  '__defineGetter__',
  '__defineSetter__',
  'hasOwnProperty',
  '__lookupGetter__',
  '__lookupSetter__',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'valueOf',
  '__proto__',
  'toLocaleString',
];

describe('Collection', function () {
  // for proper collection tests we need the server to be active

  before(function () {
    if (!Data.ddp) {
      Data.ddp = new DDP({
        SocketConstructor: WebSocket,
        endpoint,
        autoConnect: false,
      });
      Data.ddp.socket.on('open', () => {
        Data.ddp.socket.emit('message:in', { msg: 'connected' });
      });
      Data.ddp.connect();

      // we simulate similar behaviour as in Meteor.call
      // but without relying on Meteor here
      Data.ddp.socket.on('message:in', (message) => {
        if (!message.id) return;

        const call = Data.calls.find((call) => call.id === message.id);
        if (!call) return;

        if (typeof call.callback === 'function') {
          call.callback(message.error, message.result);
        }
        Data.calls.splice(
          Data.calls.findIndex((call) => call.id === message.id),
          1
        );
      });
    }
  });

  describe('constructor', function () {
    it('is exported via Mongo', () => {
      expect(Mongo.Collection).to.equal(Collection);
    });
    it('creates a new collection and one in Minimongo', function () {
      const name = Random.id(6);
      const c = new Collection(name);
      expect(c._name).to.equal(name);
      expect(c._transform).to.equal(null);
      expect(c._collection).to.equal(Data.db.collections[name]);
      expect(c._collection.name).to.equal(name);
      expect(c._collection.constructor.name).to.equal('Collection');
    });
    it('creates a local collection and a random counterpart in minimongo', function () {
      const c = new Collection(null);
      expect(c._name).to.not.equal(null);
      expect(c.localCollection).to.equal(true);
      expect(c._transform).to.equal(null);
      expect(Data.db.collections[c._name]).to.equal(c._collection);
    });
    it('creates a collection with transform options', function () {
      let transform = () => null;
      let c;

      c = new Collection(Random.id(), { transform });
      expect(() => c._transform({})).to.throw(
        'can only transform documents with _id'
      );

      // transform returns currently null (as you can see above)
      const _id = Random.id();
      expect(() => c._transform({ _id })).to.throw(
        'transform must return object'
      );

      transform = () => ({ _id: Random.id() });
      c = new Collection(Random.id(), { transform });
      expect(() => c._transform({ _id })).to.throw(
        "transformed document can't have different _id"
      );

      transform = () => ({ foo: 'bar' });
      c = new Collection(Random.id(), { transform });
      expect(c._transform({ _id })).to.deep.equal({ _id, foo: 'bar' });
    });
    it('does not imply prototype pollution', () => {
      objectProps.forEach((name) => {
        expect(() => new Mongo.Collection(name)).to.throw(
          `Object-prototype property ${name} is not a supported Collection name`
        );
        expect(props({})).to.deep.equal(objectProps);
      });
    });
  });

});
