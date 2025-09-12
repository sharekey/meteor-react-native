const endpoint = 'ws://localhost:3000/websocket';
const { Server } = require('mock-socket');

let serverInstance;

module.exports = {
  mochaGlobalSetup() {
    console.debug('Open mockserver on', endpoint);
    serverInstance = new Server(endpoint);

    const messageFn = (data) => serverInstance.emit('message', data);
    let currentMessageFn = messageFn;

    serverInstance.message = (fn) => {
      if (typeof fn === 'function') {
        currentMessageFn = fn;
      } else {
        currentMessageFn = messageFn;
      }
    };

    serverInstance.on('connection', (socket) => {
      socket.on('message', (data) => {
        currentMessageFn(data, serverInstance, socket);
      });
    });

    globalThis.__mockServerAccessor = () => serverInstance;
  },
  mochaGlobalTeardown() {
    console.debug('Closing mockserver');
    serverInstance && serverInstance.stop();
  },
  server: () =>
    (globalThis.__mockServerAccessor && globalThis.__mockServerAccessor()) ||
    serverInstance,
};
