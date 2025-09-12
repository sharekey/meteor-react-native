const endpoint = 'ws://localhost:3000/websocket';
const { Server } = require('mock-socket');

let server;

module.exports = {
  mochaGlobalSetup() {
    console.debug('Open mockserver on', endpoint);
    server = new Server(endpoint);

    const messageFn = (data) => server.emit('message', data);
    let currentMessageFn = messageFn;

    server.message = (fn) => {
      if (typeof fn === 'function') {
        currentMessageFn = fn;
      } else {
        currentMessageFn = messageFn;
      }
    };

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        currentMessageFn(data, server, socket);
      });
    });
  },
  mochaGlobalTeardown() {
    console.debug('Closing mockserver');
    server && server.stop();
  },
  server: () => server,
};
