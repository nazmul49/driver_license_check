// Preloaded with --import in a child process (and inherited by its worker threads through
// execArgv). Any attempt to open a socket, resolve a name or fetch fails loudly and is
// reported on stderr, so the parent test can assert that nothing tried.
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { isMainThread } from 'node:worker_threads';

const report = (what) => {
  process.stderr.write(`NETWORK_ATTEMPT ${what} thread=${isMainThread ? 'main' : 'worker'}\n`);
  throw new Error(`Network access blocked in test: ${what}`);
};

net.Socket.prototype.connect = function () {
  report('net.Socket.connect');
};
net.connect = net.createConnection = () => report('net.connect');
tls.connect = () => report('tls.connect');
http.request = http.get = () => report('http.request');
https.request = https.get = () => report('https.request');
dns.lookup = () => report('dns.lookup');
dns.promises.lookup = async () => report('dns.promises.lookup');
globalThis.fetch = async (url) => report(`fetch ${String(url)}`);
