import Data from './Data';

/**
 * Calls a method over DDP with given arguments
 * @param eventName {string} required, the method to call
 * @param args {...array} optional arguments
 */
export default function call(eventName: string, ...rest: unknown[]): void {
  const args = rest.slice();
  let callback: ((err?: unknown, result?: unknown) => void) | undefined;
  if (args.length && typeof args[args.length - 1] === 'function') {
    callback = args.pop() as (err?: unknown, result?: unknown) => void;
  }

  const ddp = Data.ddp;
  if (!ddp)
    throw new Error('DDP is not initialized. Call Meteor.connect() first.');
  const id = ddp.method(eventName, args);
  const entry: any = { id };
  if (callback) entry.callback = callback;
  Data.calls.push(entry);
}
