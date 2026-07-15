"use strict";

const path = require("path");

const defaultConfig = require("../config");
const defaultDatabase = require("../db");
const defaultStore = require("../object-store");
const defaultHttp = require("../http-response");
const { createLifecycle } = require("../lifecycle");
const { createStaticHandler } = require("../static-handler");

function createRuntimeContext(overrides = {}) {
  const config = overrides.config || defaultConfig;
  const database = overrides.database || defaultDatabase;
  const store = overrides.store || defaultStore;
  const http = overrides.http || defaultHttp;
  const lifecycle = overrides.lifecycle || createLifecycle();
  const staticHandler = overrides.staticHandler || createStaticHandler({
    distRoot: overrides.distRoot || path.resolve(__dirname, "..", "..", "dist"),
    sendError: http.sendError,
  });

  return Object.freeze({
    config,
    database,
    store,
    http,
    lifecycle,
    staticHandler,
  });
}

module.exports = {
  createRuntimeContext,
};
