import { expect } from 'chai';
import { WebSocket } from 'mock-socket';
import Meteor from '../../src/index';
import { endpoint, awaitDisconnected } from '../testHelpers';
import { server } from '../hooks/mockServer';

// Long enough for a second copy of a message to reach the mock server.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

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
  let answerDelays;
  let rejectedSubs;
  let loginRequired;
  let loggedInSockets;

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
    let answer;
    const answered = new Promise((resolve) => {
      answer = resolve;
    });
    const queued = new Promise((resolve) => {
      ddp.once('disconnected', () => {
        Meteor.call(method, {}, (error, result) => answer({ error, result }));
        resolve();
      });
    });

    ddp.socket.rawSocket.close();
    await queued;
    expect(ddp.status).to.equal('disconnected');
    return { answered };
  };

  const methodNames = () =>
    received.filter(({ msg }) => msg === 'method').map(({ method }) => method);

  beforeEach(function () {
    received = [];
    sessionCount = 0;
    answerDelays = new Map();
    rejectedSubs = new Set();
    loginRequired = new Set();
    loggedInSockets = new WeakSet();

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

      if (message.msg === 'sub' && rejectedSubs.has(message.name)) {
        // The server's DDPRateLimiter rejection of a subscription.
        socket.send(
          JSON.stringify({
            msg: 'nosub',
            id: message.id,
            error: {
              isClientSafe: true,
              error: 'too-many-requests',
              reason: 'Error, too many requests. Please slow down.',
              details: { timeToReset: 400 },
              errorType: 'Meteor.Error',
            },
          })
        );
        return;
      }

      if (message.msg === 'method') {
        const isLogin = message.method === 'login';
        // The backend refuses these on a session that has no login result yet.
        const refused =
          loginRequired.has(message.method) && !loggedInSockets.has(socket);
        const answer = () => {
          if (isLogin) loggedInSockets.add(socket);
          socket.send(
            JSON.stringify(
              refused
                ? {
                    msg: 'result',
                    id: message.id,
                    error: {
                      isClientSafe: true,
                      error: 'not-authorized',
                      reason: 'User not authorized',
                      errorType: 'Meteor.Error',
                    },
                  }
                : {
                    msg: 'result',
                    id: message.id,
                    result: isLogin
                      ? {
                          id: 'user',
                          token: 'token',
                          tokenExpires: { $date: 1 },
                        }
                      : 'ok',
                  }
            )
          );
        };

        const delay = answerDelays.get(message.method);
        if (delay) {
          setTimeout(answer, delay);
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

    const { answered } = await dropSocketAndCallDuringReconnect(
      ddp,
      'auth.createRandomChallenge'
    );
    await waitUntil(
      () => sessionCount === 2 && ddp.status === 'connected',
      'second session'
    );

    const { error, result } = await answered;
    expect(error).to.equal(undefined);
    expect(result).to.equal('ok');
    await settle();
    expect(methodNames()).to.deep.equal(['auth.createRandomChallenge']);
  });

  // M-3494: a deep-link lookup queued while the app was in the background went out before the resume login on the
  // new session, and the backend refused it with not-authorized.
  it('sends a method queued while reconnecting after the resume login result', async function () {
    const method = 'people.user.getByPID';
    loginRequired.add(method);
    const ddp = connect('stored-token');
    await waitUntil(
      () => methodNames().includes('login'),
      'first resume login'
    );
    await waitUntil(
      () => ddp.shouldReplayActionsOnLogin === false,
      'first login result'
    );
    received.length = 0;
    answerDelays.set('login', 30);

    const { answered } = await dropSocketAndCallDuringReconnect(ddp, method);

    const { error, result } = await answered;
    expect(error).to.equal(undefined);
    expect(result).to.equal('ok');
    await settle();
    expect(methodNames()).to.deep.equal(['login', method]);
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

  // M-3486: a nosub with an error ended the subscription for the app, but the client kept it among its active
  // subscriptions and sent it again after every reconnect, where nothing could stop it.
  it('does not restore a subscription the server rejected', async function () {
    rejectedSubs.add('people.currentUserContacts');
    const ddp = connect(null);
    await waitUntil(
      () => sessionCount === 1 && ddp.status === 'connected',
      'first session'
    );

    let rejection;
    Meteor.subscribe('people.currentUserContacts', {
      onError: (error) => {
        rejection = error;
      },
    });
    Meteor.subscribe('backendVersion.current');
    await waitUntil(
      () => rejection !== undefined,
      'the rejection reaches the app'
    );
    expect(rejection.error).to.equal('too-many-requests');
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
      'the live subscription on the new session'
    );
    expect(
      received.filter(
        ({ msg, name }) =>
          msg === 'sub' && name === 'people.currentUserContacts'
      )
    ).to.have.length(0);
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
    answerDelays.set('login', 30);

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

  // Called from the `connected` event: after the socket opens, before the token is read.
  const callOnConnected = (ddp, method) =>
    new Promise((resolve) => {
      ddp.once('connected', () => Meteor.call(method, {}, resolve));
    });

  const timesSent = (method) =>
    methodNames().filter((name) => name === method).length;

  it('sends a method called before the token is read once', async function () {
    const method = 'auth.sendEmailCode';
    answerDelays.set(method, 30);

    const ddp = connect(null);
    const error = await callOnConnected(ddp, method);

    expect(error).to.equal(undefined);
    expect(ddp.shouldReplayActionsOnLogin).to.equal(false);
    await settle();
    expect(timesSent(method)).to.equal(1);
  });

  it('sends a method called before the login result once, after that result', async function () {
    const method = 'auth.sendEmailCode';
    loginRequired.add(method);
    answerDelays.set('login', 30);
    answerDelays.set(method, 60);

    const ddp = connect('stored-token');
    const error = await callOnConnected(ddp, method);

    expect(error).to.equal(undefined);
    expect(ddp.shouldReplayActionsOnLogin).to.equal(false);
    await settle();
    expect(methodNames()).to.deep.equal(['login', method]);
  });
});
