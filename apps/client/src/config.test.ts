import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig, loadConfig, resetConfig, setConfig } from "./config";

const respond = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => body }));

afterEach(() => {
  vi.unstubAllGlobals();
  resetConfig();
});

describe("getConfig", () => {
  it("returns schema defaults before setConfig is called", () => {
    expect(getConfig()).toEqual({ API_URL: "" });
  });

  it("returns what setConfig published", () => {
    setConfig({ API_URL: "https://api.published" });
    expect(getConfig()).toEqual({ API_URL: "https://api.published" });
  });

  it("resetConfig restores the defaults", () => {
    setConfig({ API_URL: "https://api.published" });
    resetConfig();
    expect(getConfig()).toEqual({ API_URL: "" });
  });
});

describe("loadConfig", () => {
  it("reads an absolute API url", async () => {
    respond({ API_URL: "https://api.prod" });
    expect(await loadConfig()).toEqual({ API_URL: "https://api.prod" });
  });

  it("accepts a same-origin path, for ingress-proxied APIs", async () => {
    respond({ API_URL: "/api" });
    expect(await loadConfig()).toEqual({ API_URL: "/api" });
  });

  it("keeps defaults for keys config.json omits", async () => {
    respond({});
    expect(await loadConfig()).toEqual({ API_URL: "" });
  });

  it("falls back when config.json is missing", async () => {
    respond(undefined, false);
    expect(await loadConfig()).toEqual({ API_URL: "" });
  });

  it("falls back when the request fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await loadConfig()).toEqual({ API_URL: "" });
  });

  it("rejects a value of the wrong type rather than coercing it", async () => {
    respond({ API_URL: 123 });
    await expect(loadConfig()).rejects.toThrow(/Invalid config.json/);
  });

  it("rejects a string that is neither a url nor a path", async () => {
    respond({ API_URL: "api.example.com" });
    await expect(loadConfig()).rejects.toThrow(/Invalid config.json/);
  });
});
