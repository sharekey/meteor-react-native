type LoggerPayload = object | string;

interface QueueOptions {
  logger?: (msg: LoggerPayload) => void;
  isVerbose?: boolean;
}

/**
 * What the consumer did with an element: `true` sent it, `false` cannot send
 * anything now, so processing stops, and `'held'` keeps this element in place
 * while the elements behind it may still go.
 */
export type ConsumerAck = boolean | 'held';

/**
 * The internal message queue for the DDP protocol.
 */
export default class Queue<T extends object = any> {
  private queue: T[] = [];
  private logger: ((entry: LoggerPayload) => void) | undefined;
  private isVerbose: boolean;
  private ids: WeakMap<T, string> = new WeakMap();
  private counter = 1;
  /**
   * As the name implies, `Consumer` is the (sole) consumer of the queue.
   *
   * It gets called with each element of the queue and its return value
   * serves as a ack, determining whether the element is removed or not from
   * the queue, allowing then subsequent elements to be processed. A held
   * element stays in the queue without stopping the elements behind it.
   *
   * @constructor
   * @param {function} consumer function to be called when the next element in the queue is to be processed
   * @param logger optional logger used when pushing elements (when isVerbose is true)
   * @param isVerbose optional flag to enable logging
   */
  constructor(
    private consumer: (element: T) => ConsumerAck,
    options: QueueOptions = {
      isVerbose: false,
    }
  ) {
    this.logger = options.logger;
    this.isVerbose = options.isVerbose ?? false;
  }

  setLoggingOptions(options: QueueOptions): void {
    if (options.logger !== undefined) {
      this.logger = options.logger;
    }
    if (options.isVerbose !== undefined) {
      this.isVerbose = options.isVerbose;
    }
  }

  /**
   * Adds a new element to the queue
   * @param element {any} likely an object
   */
  push(element: T): void {
    this.assignId(element);
    this.log('ENQUEUE', element);
    this.queue.push(element);
    this.process();
  }

  /**
   * Sync; processes the queue by each element, starting with the first
   * and passing each to the consumer.
   */
  process(): void {
    let index = 0;
    while (index < this.queue.length) {
      const current = this.queue[index]!;
      this.log('DEQUEUE_ATTEMPT', current);
      const ack = this.consumer(current);
      if (ack === 'held') {
        this.log('DEQUEUE_HELD', current);
        index += 1;
      } else if (ack) {
        this.queue.splice(index, 1);
        this.log('DEQUEUE_SUCCESS', current);
      } else {
        this.log('DEQUEUE_FAILED', current);
        return;
      }
    }
  }

  /**
   * Prepends a batch of elements to the front of the queue (preserves order)
   * and triggers processing.
   */
  prepend(elements: T[]): void {
    if (!elements.length) return;
    elements.forEach((el) => {
      this.assignId(el);
      this.log('ENQUEUE', el);
    });
    this.queue = [...elements, ...this.queue];
    this.process();
  }

  /**
   * Removes the elements that match without passing them to the consumer.
   * @returns the removed elements, in queue order
   */
  remove(predicate: (element: T) => boolean): T[] {
    const removed = this.queue.filter(predicate);
    if (!removed.length) return removed;
    this.queue = this.queue.filter((element) => !predicate(element));
    removed.forEach((element) => this.log('DEQUEUE_DROPPED', element));
    return removed;
  }

  /**
   * Clears all elements from the queue
   */
  empty(): void {
    if (this.queue.length) {
      const ids = this.queue.map((el) => this.getId(el));
      this.logRaw({ QUEUE: 'CLEAR', queueIds: ids, length: this.queue.length });
    }
    this.queue = [] as T[];
  }

  private assignId(element: T) {
    if (!this.ids.has(element)) {
      this.ids.set(element, String(this.counter++));
    }
  }

  private getId(element: T): string {
    this.assignId(element);
    return this.ids.get(element)!;
  }

  private log(event: string, element: T) {
    if (!this.isVerbose || !this.logger) return;
    const copy: any = {
      QUEUE: event,
      queueId: this.getId(element),
      ...(element as any),
    };
    if ('params' in copy) {
      const { params, ...rest } = copy;
      this.logRaw(rest);
      return;
    }
    this.logRaw(copy);
  }

  private logRaw(entry: any) {
    if (!this.isVerbose || !this.logger) return;
    try {
      this.logger(entry);
    } catch (_e) {
      // no-op
    }
  }
}
