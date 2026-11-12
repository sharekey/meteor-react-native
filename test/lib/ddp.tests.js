import DDP from '../../lib/ddp';
import { WebSocket } from 'mock-socket';
import { expect } from 'chai';
import { server } from '../hooks/mockServer';

describe('ddp', function () {
  let validOptions;
  let ddp;
  const endpoint = 'ws://localhost:3000/websocket';

  // instead of manually adding/removing listeners we
  // add them to this array and remove them all during
  // afterEach hook so we prevent mem-leaks and false
  // assertions due to old listeners catching up new messages
  const listeners = [];
  const listen = (target, event, fn) => {
    target.on(event, fn);
    listeners.push({ target, event, fn });
  };

  beforeEach(function () {
    validOptions = {
      SocketConstructor: WebSocket,
      endpoint,
    };
  });

  afterEach(function () {
    if (ddp) {
      ddp.disconnect();
    }

    while (listeners.length) {
      const { target, event, fn } = listeners.pop();
      target.off(event, fn);
    }
  });

  it('should throw an error if not passed a socketConstructor', function () {
    expect(() => new DDP({})).to.throw(
      'this.SocketConstructor is not a constructor'
    );
  });

  it('should throw an error given no endpoint', function () {
    expect(
      () =>
        new DDP({
          SocketConstructor: WebSocket,
        })
    ).to.throw(
      "Failed to construct 'WebSocket': 1 argument required, but only 0 present"
    );
  });

  it('should start in the disconnected state', function () {
    ddp = new DDP(validOptions);
    expect(ddp.status).to.equal('disconnected');
  });

  it('should start with autoreconnect true given no autoReconnect parameter', function () {
    ddp = new DDP(validOptions);
    expect(ddp.autoReconnect).to.equal(true);
  });

  it('should start with autoreconnect false given autoReconnect parameter set to false', function () {
    validOptions.autoReconnect = false;
    ddp = new DDP(validOptions);
    expect(ddp.autoReconnect).to.equal(false);
  });

  it('should start with autoconnect true given no autoConnect parameter', function () {
    ddp = new DDP(validOptions);
    expect(ddp.autoConnect).to.equal(true);
  });

  it('should start with autoconnect false given autoReconnect parameter set to false', function () {
    validOptions.autoConnect = false;
    ddp = new DDP(validOptions);
    expect(ddp.autoConnect).to.equal(false);
  });

  it('opens a socket connection', function (done) {
    validOptions.autoConnect = false;
    ddp = new DDP(validOptions);
    listen(ddp.socket, 'open', () => {
      done();
    });
    ddp.connect();
  });
  it('opens socket only once', function (done) {
    ddp = new DDP(validOptions);

    let count = 0;
    listen(ddp.socket, 'open', () => {
      count++;
    });

    ddp.connect();
    ddp.connect();
    ddp.connect();
    ddp.connect();
    ddp.connect();
    ddp.connect();

    setTimeout(() => {
      expect(count).to.equal(1);
      done();
    }, 15);
  });

  it('answers endpoint ping with pong messages', function (done) {
    validOptions.autoConnect = false;
    ddp = new DDP(validOptions);
    ddp.connect();

    listen(ddp.socket, 'message:out', (message) => {
      if (message.msg === 'pong') {
        expect(message.id).to.equal(99);
        done();
      }
    });

    listen(ddp.socket, 'open', () => {
      ddp.socket.emit('message:in', { msg: 'connected' });
      ddp.socket.emit('message:in', { msg: 'ping', id: 99 });
    });
  });
  it('auto-reconnects if socket closed unexpected', function (done) {
    validOptions.autoConnect = false;
    validOptions.autoReconnect = true;
    validOptions.reconnectInterval = 500;
    ddp = new DDP(validOptions);
    let expected = false;

    listen(ddp.socket, 'open', () => {
      ddp.socket.emit('message:in', { msg: 'connected' });
    });
    listen(ddp, 'connected', () => {
      if (expected) {
        done();
      }
    });

    ddp.connect();

    setTimeout(() => {
      expected = true;
      ddp.socket.close();
    }, 25);
  });
  it('only receives valid message from rawSocket', function (done) {
    ddp = new DDP(validOptions);

    const validObj = { foo: 'bar' };
    listen(ddp.socket, 'message:in', (obj) => {
      if (obj.msg) return; // ignore the real ones, just check for our foo
      expect(obj).to.deep.equal(validObj);
      done();
    });

    // to be ignored
    server().emit('message', '{"invalid":');

    // should be valid
    server().emit('message', '{"foo":"bar"}');
  });

  describe('events', function () {
    it('emits custom events', function (done) {
      ddp = new DDP(validOptions);
      listen(ddp, 'foo', () => done());
      ddp.emit('foo');
    });
    it('re-emits incoming public events', function (done) {
      ddp = new DDP(validOptions);
      listen(ddp, 'ready', () => {
        done();
      });

      server().emit('message', '{"msg":"ready"}');
    });
    it('emits connected event', function (done) {
      validOptions.autoConnect = false;
      ddp = new DDP(validOptions);
      listen(ddp, 'connected', () => done());
      ddp.connect();
      listen(ddp.socket, 'open', () => {
        ddp.socket.emit('message:in', { msg: 'connected' });
      });
    });
    it('emits disconnected event', function (done) {
      validOptions.autoConnect = true;
      validOptions.autoReconnect = true;

      ddp = new DDP(validOptions);
      listen(ddp, 'disconnected', () => {
        // will be set to false when actively calling disconnect
        expect(ddp.autoReconnect).to.equal(false);
        done();
      });

      listen(ddp.socket, 'open', () => {
        ddp.socket.emit('message:in', { msg: 'connected' });
      });

      listen(ddp, 'connected', () => {
        ddp.disconnect();
      });
    });
  });

  describe('methods', function () {
    it('adds a method to the message queue, to be sent via socket', function (done) {
      validOptions.autoConnect = false;
      validOptions.autoReconnect = false;
      ddp = new DDP(validOptions);
      ddp.disconnect();

      // should ignore methods when not connected
      // but when connected the queue will run
      ddp.method('foo', { foo: 'bar' });

      listen(ddp.socket, 'message:out', (message) => {
        if (message.msg === 'method') {
          expect(message.id).to.equal('0');
          expect(message.method).to.equal('foo');
          expect(message.params).to.deep.equal({
            foo: 'bar',
          });
          done();
        }
      });

      ddp.connect();
      listen(ddp.socket, 'open', () => {
        ddp.socket.emit('message:in', { msg: 'connected' });
      });
    });
  });
  describe('sub/unsub', function () {
    it('handles subscriptions', function () {
      validOptions.autoConnect = false;
      validOptions.autoReconnect = false;
      ddp = new DDP(validOptions);
      ddp.disconnect();

      // should ignore methods when not connected
      // but when connected the queue will run
      ddp.sub('foo', { foo: 'bar' });

      listen(ddp.socket, 'message:out', (message) => {
        if (message.msg === 'sub') {
          expect(message.id).to.equal('1');
          expect(message.method).to.equal('foo');
          expect(message.params).to.deep.equal({
            foo: 'bar',
          });
          done();
        }
      });

      ddp.connect();
      listen(ddp.socket, 'open', () => {
        ddp.socket.emit('message:in', { msg: 'connected' });
      });
    });
    it('handles unsubscription', function () {
      validOptions.autoConnect = false;
      validOptions.autoReconnect = false;
      ddp = new DDP(validOptions);
      ddp.disconnect();

      // should ignore methods when not connected
      // but when connected the queue will run
      ddp.unsub('1');

      listen(ddp.socket, 'message:out', (message) => {
        if (message.msg === 'unsub') {
          expect(message.id).to.equal('2');
          expect(message.method).to.equal('foo');
          expect(message.params).to.deep.equal({
            foo: 'bar',
          });
          done();
        }
      });

      ddp.connect();
      listen(ddp.socket, 'open', () => {
        ddp.socket.emit('message:in', { msg: 'connected' });
      });
    });
  });
  describe('waiting for the login result on a new session', function () {
    let sent;
    const sentIds = () => sent.map(({ id }) => id);

    beforeEach(function () {
      ddp = new DDP({
        ...validOptions,
        autoConnect: false,
        autoReconnect: false,
        deferReplayUntilLogin: true,
      });
      sent = [];
      ddp.socket.send = (message) => sent.push(message);
    });

    it('sends a login queued behind the messages it holds', function () {
      const lookupId = ddp.method('people.user.getByPID', []);
      const subId = ddp.sub('backendVersion.current', []);
      const loginId = ddp.method('login', [{ resume: 'token' }]);

      ddp.socket.emit('message:in', { msg: 'connected', session: 's1' });
      expect(sentIds()).to.deep.equal([loginId]);

      const lateId = ddp.method('channels.list', []);
      expect(sentIds()).to.deep.equal([loginId]);

      ddp.socket.emit('message:in', { msg: 'result', id: loginId, result: {} });
      expect(sentIds()[0]).to.equal(loginId);
      expect([...sentIds()].sort()).to.deep.equal(
        [loginId, lookupId, subId, lateId].sort()
      );
    });

    it('sends a login pushed while the hold is on', function () {
      const lookupId = ddp.method('people.user.getByPID', []);
      ddp.socket.emit('message:in', { msg: 'connected', session: 's1' });
      expect(sent).to.have.length(0);

      const loginId = ddp.method('login', [{ resume: 'token' }]);
      expect(sentIds()).to.deep.equal([loginId]);

      ddp.socket.emit('message:in', {
        msg: 'result',
        id: loginId,
        error: { error: 403 },
      });
      expect(sentIds()).to.deep.equal([loginId, lookupId]);
    });

    it('sends the held messages when the hold is released without a login', function () {
      const challengeId = ddp.method('auth.createRandomChallenge', []);
      const subId = ddp.sub('backendVersion.current', []);
      ddp.socket.emit('message:in', { msg: 'connected', session: 's1' });
      expect(sent).to.have.length(0);

      ddp.releaseDeferredReplay();
      expect([...sentIds()].sort()).to.deep.equal([challengeId, subId].sort());
    });

    it('sends queued messages at once on a reused session', function () {
      ddp.socket.emit('message:in', { msg: 'connected', session: 's1' });
      ddp.releaseDeferredReplay();
      ddp.socket.emit('close');
      const lookupId = ddp.method('people.user.getByPID', []);

      ddp.socket.emit('message:in', { msg: 'connected', session: 's1' });
      expect(sentIds()).to.deep.equal([lookupId]);
    });

    it('never sends a queued method dropped by id', function () {
      const failedId = ddp.method('people.user.getByPID', []);
      const keptId = ddp.method('channels.list', []);
      const subId = ddp.sub('backendVersion.current', []);
      expect(ddp.dropQueuedMethods([failedId, subId, 'unknown'])).to.deep.equal(
        [failedId]
      );

      ddp.socket.emit('message:in', { msg: 'connected', session: 's1' });
      ddp.releaseDeferredReplay();
      expect([...sentIds()].sort()).to.deep.equal([keptId, subId].sort());
    });

    it('does not drop a method already sent', function () {
      ddp.socket.emit('message:in', { msg: 'connected', session: 's1' });
      const loginId = ddp.method('login', [{ resume: 'token' }]);
      expect(sentIds()).to.deep.equal([loginId]);
      expect(ddp.dropQueuedMethods([loginId])).to.deep.equal([]);
    });
  });
  describe('logging', function () {
    it('updates logging options at runtime', function (done) {
      const logs = [];
      validOptions.autoConnect = false;
      validOptions.autoReconnect = false;
      validOptions.isVerbose = false;
      validOptions.isPrivate = true;
      validOptions.logger = (message) => logs.push(message);

      ddp = new DDP(validOptions);
      ddp.setLoggingOptions({
        isVerbose: true,
        isPrivate: false,
      });

      listen(ddp.socket, 'open', () => {
        try {
          ddp.socket.emit('message:in', {
            msg: 'connected',
            session: 'session',
          });
          ddp.method('foo', { foo: 'bar' });

          const sentMethod = logs.find(
            (message) => message.SEND === 'SEND' && message.msg === 'method'
          );
          const queuedMethod = logs.find(
            (message) => message.QUEUE === 'ENQUEUE' && message.msg === 'method'
          );

          expect(sentMethod).to.exist;
          expect(queuedMethod).to.exist;
          expect(sentMethod.params).to.deep.equal({ foo: 'bar' });
          expect(queuedMethod.params).to.equal(undefined);
          done();
        } catch (error) {
          done(error);
        }
      });

      ddp.connect();
    });
  });
});
