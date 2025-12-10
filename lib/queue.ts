interface QueueOptions {
  logger?: (msg: any) => void;
  isVerbose?: boolean;
}

/**
 * The internal message queue for the DDP protocol.
 */
export default class Queue<T extends object = any> {
  private queue: T[] = [];
  private logger: ((entry: any) => void) | undefined;
  private isVerbose: boolean;
  private ids: WeakMap<T, string> = new WeakMap();
  private counter = 1;
  /**
   * As the name implies, `Consumer` is the (sole) consumer of the queue.
   *
   * It gets called with each element of the queue and its return value
   * serves as a ack, determining whether the element is removed or not from
   * the queue, allowing then subsequent elements to be processed.
   *
   * @constructor
   * @param {function} consumer function to be called when the next element in the queue is to be processed
   * @param logger optional logger used when pushing elements (when isVerbose is true)
   * @param isVerbose optional flag to enable logging
   */
  constructor(
    private consumer: (element: T) => boolean,
    options: QueueOptions = {
      isVerbose: false,
    }
  ) {
    this.logger = options.logger;
    this.isVerbose = options.isVerbose ?? false;
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
    if (this.queue.length !== 0) {
      const current = this.queue[0]!;
      this.log('DEQUEUE_ATTEMPT', current);
      const ack = this.consumer(current);
      if (ack) {
        this.queue.shift();
        this.log('DEQUEUE_SUCCESS', current);
        this.process();
      } else {
        this.log('DEQUEUE_FAILED', current);
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
    if (copy.params !== undefined) {
      delete copy.params;
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
