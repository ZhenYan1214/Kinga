// Simulated offline for Node processes: every connection to anything but this machine fails the way it does with
// Wi-Fi off, and each attempt is logged. offline-proof --simulate-offline loads it with NODE_OPTIONS=--require, so it
// applies to the Kinga server and every Node process it starts. QVAC's Bare worker is not Node: the proof watches it.
"use strict";
const net = require("node:net");
const dgram = require("node:dgram");
const dns = require("node:dns");
const { appendFileSync } = require("node:fs");

const LOG = process.env.KINGA_BLOCK_LOG;
const isLocal = (host) => {
  const h = String(host ?? "localhost").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\./.test(h) || /^::ffff:127\./.test(h);
};
function offlineError(kind, target) {
  if (LOG) appendFileSync(LOG, `${new Date().toISOString()} pid ${process.pid} ${kind} ${target}\n`);
  const error = new Error(`getaddrinfo ENOTFOUND ${target} (simulated offline)`);
  error.code = "ENOTFOUND";
  error.hostname = String(target);
  return error;
}

// TCP and TLS (http, https, fetch) all end in Socket#connect. Pipes and IPC (a `path`) stay allowed.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first !== null && typeof first === "object" ? first : { port: first, host: typeof args[1] === "string" ? args[1] : undefined };
  if (options.path === undefined && !isLocal(options.host)) {
    const error = offlineError("tcp", `${options.host}:${options.port}`);
    process.nextTick(() => this.destroy(error));
    return this;
  }
  return connect.apply(this, args);
};

// Name lookups, including c-ares resolvers that would query a DNS server directly.
const lookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (isLocal(hostname)) return lookup.call(this, hostname, ...rest);
  const callback = rest.find((a) => typeof a === "function");
  const error = offlineError("dns", hostname);
  process.nextTick(() => callback?.(error));
  return {};
};
const promisesLookup = dns.promises.lookup;
dns.promises.lookup = (hostname, ...rest) => (isLocal(hostname) ? promisesLookup(hostname, ...rest) : Promise.reject(offlineError("dns", hostname)));
for (const name of Object.keys(dns).filter((n) => n.startsWith("resolve"))) {
  dns[name] = (hostname, ...rest) => {
    const callback = rest.find((a) => typeof a === "function");
    const error = offlineError("dns", hostname);
    process.nextTick(() => callback?.(error));
  };
}
for (const name of Object.keys(dns.promises).filter((n) => n.startsWith("resolve"))) {
  dns.promises[name] = (hostname) => Promise.reject(offlineError("dns", hostname));
}

// UDP (a DHT or QUIC would use it).
const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (...args) {
  const address = args.slice(1).find((a) => typeof a === "string");
  if (address !== undefined && !isLocal(address)) {
    const error = offlineError("udp", address);
    const callback = args.find((a) => typeof a === "function");
    process.nextTick(() => (callback ? callback(error) : this.emit("error", error)));
    return;
  }
  return send.apply(this, args);
};
const udpConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function (port, address, callback) {
  if (typeof address === "string" && !isLocal(address)) {
    const error = offlineError("udp", `${address}:${port}`);
    process.nextTick(() => this.emit("error", error));
    return;
  }
  return udpConnect.call(this, port, address, callback);
};
