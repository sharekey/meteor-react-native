import { expect } from 'chai';
import { WebSocket } from 'mock-socket';
import Meteor from '../../src/index';
import { endpoint, awaitDisconnected } from '../testHelpers';
import { server } from '../hooks/mockServer';

const waitUntil = async (predicate, description, timeoutMs = 700) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('Meteor - replay after reconnecting on a new session', function () {
  let received;
  let sessionCount;
  let isLoginAnswerHeld;

  const connect = (storedToken) => {
    Meteor.connect(endpoint, {
      NetInfo: null,
      reconnectInterval: 10,
      SocketConstructor: WebSocket,
      KeyStorage: {
        getItem: async (key) =>
          key === 'Meteor.loginToken' ? storedToken : null,
        setItem: async () => {},
        removeItem: async () => {},
      },
    });

    return Meteor.getData().ddp;
  };

  // Queues a method exactly when the app does: socket down, reconnect pending.
  const dropSocketAndCallDuringReconnect = async (ddp, method) => {
    const queued = new Promise((resolve) => {
      ddp.once('disconnected', () => {
        Meteor.call(method, {}, () => {});
        resolve();
      });
    });

    ddp.socket.rawSocket.close();
    await queued;
    expect(ddp.status).to.equal('disconnected');
  };

  const methodNames = () =>
    received.filter(({ msg }) => msg === 'method').map(({ method }) => method);

  beforeEach(function () {
    received = [];
    sessionCount = 0;
    isLoginAnswerHeld = false;

    server().message((data, _server, socket) => {
      const message = JSON.parse(data);

      if (message.msg === 'connect') {
        sessionCount += 1;
        socket.send(
          JSON.stringify({ msg: 'connected', session: `s${sessionCount}` })
        );
        return;
      }

      received.push(message);

      if (message.msg === 'method') {
        const isLogin = message.method === 'login';
        const answer = () =>
          socket.send(
            JSON.stringify({
              msg: 'result',
              id: message.id,
              result: isLogin
                ? { id: 'user', token: 'token', tokenExpires: { $date: 1 } }
                : 'ok',
            })
          );

        if (isLogin && isLoginAnswerHeld) {
          setTimeout(answer, 30);
        } else {
          answer();
        }
      }
    });
  });

  afterEach(async function () {
    server().message(null);
    await awaitDisconnected();
  });

  it('sends a method queued while reconnecting when no login token is stored', async function () {
    const ddp = connect(null);
    await waitUntil(
      () => sessionCount === 1 && ddp.status === 'connected',
      'first session'
    );

    await dropSocketAndCallDuringReconnect(ddp, 'auth.createRandomChallenge');
    await waitUntil(
      () => sessionCount === 2 && ddp.status === 'connected',
      'second session'
    );

    await waitUntil(
      () => methodNames().includes('auth.createRandomChallenge'),
      'the queued method on the new session'
    );
    expect(methodNames()).to.not.include('login');
  });

  it('restores active subscriptions when no login token is stored', async function () {
    const ddp = connect(null);
    await waitUntil(
      () => sessionCount === 1 && ddp.status === 'connected',
      'first session'
    );

    Meteor.subscribe('backendVersion.current');
    await waitUntil(
      () => received.some(({ msg }) => msg === 'sub'),
      'first sub'
    );
    received.length = 0;

    ddp.socket.rawSocket.close();
    await waitUntil(
      () => sessionCount === 2 && ddp.status === 'connected',
      'second session'
    );

    await waitUntil(
      () =>
        received.some(
          ({ msg, name }) => msg === 'sub' && name === 'backendVersion.current'
        ),
      'the subscription on the new session'
    );
  });

  it('keeps restoring subscriptions behind the resume login when a token is stored', async function () {
    const ddp = connect('stored-token');
    await waitUntil(
      () => methodNames().includes('login'),
      'first resume login'
    );
    await waitUntil(
      () => ddp.shouldReplayActionsOnLogin === false,
      'first login result'
    );

    Meteor.subscribe('backendVersion.current');
    await waitUntil(
      () => received.some(({ msg }) => msg === 'sub'),
      'first sub'
    );
    received.length = 0;
    isLoginAnswerHeld = true;

    ddp.socket.rawSocket.close();
    await waitUntil(
      () => methodNames().includes('login'),
      'resume login on the new session'
    );
    expect(received.some(({ msg }) => msg === 'sub')).to.equal(false);

    await waitUntil(
      () =>
        received.some(
          ({ msg, name }) => msg === 'sub' && name === 'backendVersion.current'
        ),
      'the subscription after the login result'
    );
    expect(received.map(({ msg }) => msg)).to.deep.equal(['method', 'sub']);
  });
});
