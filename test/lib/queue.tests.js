import Queue from '../../lib/queue';
import { expect } from 'chai';

describe('queue', function () {
  it('delegates operations to a consumer', function () {
    const q = new Queue((obj) => {
      expect(q.queue.length).to.equal(1);
      expect(obj.id).to.equal('foo');
      return true;
    });
    q.push({ id: 'foo' });
    expect(q.queue.length).to.equal(0);

    q.consumer = () => false;
    q.push({ id: 'foo' });
    expect(q.queue.length).to.equal(1);

    q.empty();
    expect(q.queue.length).to.equal(0);
  });

  it('passes over elements the consumer holds', function () {
    const consumed = [];
    let holding = true;
    const q = new Queue((obj) => {
      if (holding && obj.id !== 'login') return 'held';
      consumed.push(obj.id);
      return true;
    });

    q.push({ id: 'lookup' });
    q.push({ id: 'login' });
    q.push({ id: 'list' });
    expect(consumed).to.deep.equal(['login']);
    expect(q.queue.map(({ id }) => id)).to.deep.equal(['lookup', 'list']);

    holding = false;
    q.process();
    expect(consumed).to.deep.equal(['login', 'lookup', 'list']);
    expect(q.queue.length).to.equal(0);
  });

  it('stops at an element the consumer cannot send', function () {
    const consumed = [];
    let connected = false;
    const q = new Queue((obj) => {
      if (!connected) return false;
      consumed.push(obj.id);
      return true;
    });

    q.push({ id: 'lookup' });
    q.push({ id: 'login' });
    expect(consumed).to.deep.equal([]);

    connected = true;
    q.process();
    expect(consumed).to.deep.equal(['lookup', 'login']);
  });
});
