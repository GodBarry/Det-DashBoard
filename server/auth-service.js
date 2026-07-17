"use strict";

const crypto = require("crypto");

function createAuthService({ query, httpError }) {
  if (typeof query !== "function") throw new TypeError("createAuthService requires query");
  if (typeof httpError !== "function") throw new TypeError("createAuthService requires httpError");

  function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
    return `pbkdf2_sha256$120000$${salt}$${hash}`;
  }

  function verifyPassword(password, storedHash = "") {
    const [scheme, iterationsText, salt, expected] = String(storedHash).split("$");
    if (scheme !== "pbkdf2_sha256" || !salt || !expected) return false;
    const iterations = Number(iterationsText || 120000);
    const actual = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256").toString("hex");
    const actualBuffer = Buffer.from(actual, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  }

  function publicUser(row = {}) {
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name || row.username,
    };
  }

  async function seedDefaultAdmin() {
    const existing = (await query("SELECT id FROM app_users WHERE username=$1", ["admin"])).rows[0];
    if (existing) return existing;
    return (await query(
      "INSERT INTO app_users (username, password_hash, role, display_name) VALUES ($1,$2,$3,$4) RETURNING id",
      ["admin", hashPassword("admin"), "admin", "管理员"],
    )).rows[0];
  }

  async function login(body = {}) {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) throw httpError(400, "请输入用户名和密码");
    const user = (await query("SELECT * FROM app_users WHERE username=$1 AND status='active'", [username])).rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) throw httpError(401, "账号或密码不正确");
    return publicUser(user);
  }

  async function register(body = {}) {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const displayName = String(body.displayName || body.display_name || username).trim();
    if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]{2,32}$/.test(username)) throw httpError(400, "用户名需为 2-32 位中文、字母、数字、下划线或短横线");
    if (password.length < 4) throw httpError(400, "密码至少 4 位");
    try {
      const row = (await query(
        "INSERT INTO app_users (username, password_hash, role, display_name) VALUES ($1,$2,'user',$3) RETURNING *",
        [username, hashPassword(password), displayName],
      )).rows[0];
      return publicUser(row);
    } catch (error) {
      if (error.code === "23505") throw httpError(409, "用户名已存在");
      throw error;
    }
  }

  return Object.freeze({
    hashPassword,
    verifyPassword,
    publicUser,
    seedDefaultAdmin,
    login,
    register,
  });
}

module.exports = {
  createAuthService,
};
