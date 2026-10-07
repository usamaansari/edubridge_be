import { Router, type Request, type RequestHandler, type Response } from "express";
import type { z } from "zod";

import type { Role } from "../db/schema/enums.js";
import { authenticate, type AuthUser } from "../middleware/auth.js";
import { forbidden } from "./http-error.js";
import { parseInput } from "./validation.js";

type Method = "get" | "post" | "put" | "patch" | "delete";
type Schema = z.ZodType | undefined;
type Output<S extends Schema, Fallback> = S extends z.ZodType ? z.output<S> : Fallback;

export interface RouteConfig<B extends Schema, Q extends Schema, P extends Schema, A extends boolean> {
  summary: string;
  description?: string;
  /** Defaults to `true`: a valid bearer token is required. */
  auth?: A;
  roles?: readonly Role[];
  body?: B;
  query?: Q;
  params?: P;
  /** Success status code. Defaults to 200. */
  status?: number;
  multipart?: boolean;
  middleware?: RequestHandler[];
}

export interface RouteContext<B extends Schema, Q extends Schema, P extends Schema, A extends boolean> {
  req: Request;
  res: Response;
  body: Output<B, undefined>;
  query: Output<Q, Record<string, unknown>>;
  params: Output<P, Record<string, string>>;
  user: A extends false ? AuthUser | undefined : AuthUser;
}

type Handler<B extends Schema, Q extends Schema, P extends Schema, A extends boolean> = (
  ctx: RouteContext<B, Q, P, A>,
) => unknown;

export interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth: boolean;
  roles?: readonly Role[];
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  status: number;
  multipart: boolean;
}

export const routeRegistry: RouteDoc[] = [];

/**
 * A router for one resource. Each route declares its auth, roles and Zod schemas once;
 * the same declaration drives validation, access control and the OpenAPI document.
 * Handlers return the response body (or `undefined` for 204).
 */
export class ApiModule {
  readonly router = Router();

  constructor(
    readonly tag: string,
    readonly prefix: string,
    readonly description?: string,
  ) {}

  get<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined, A extends boolean = true>(
    path: string,
    config: RouteConfig<B, Q, P, A>,
    handler: Handler<B, Q, P, A>,
  ) {
    return this.register("get", path, config, handler);
  }

  post<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined, A extends boolean = true>(
    path: string,
    config: RouteConfig<B, Q, P, A>,
    handler: Handler<B, Q, P, A>,
  ) {
    return this.register("post", path, config, handler);
  }

  put<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined, A extends boolean = true>(
    path: string,
    config: RouteConfig<B, Q, P, A>,
    handler: Handler<B, Q, P, A>,
  ) {
    return this.register("put", path, config, handler);
  }

  patch<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined, A extends boolean = true>(
    path: string,
    config: RouteConfig<B, Q, P, A>,
    handler: Handler<B, Q, P, A>,
  ) {
    return this.register("patch", path, config, handler);
  }

  delete<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined, A extends boolean = true>(
    path: string,
    config: RouteConfig<B, Q, P, A>,
    handler: Handler<B, Q, P, A>,
  ) {
    return this.register("delete", path, config, handler);
  }

  private register<B extends Schema, Q extends Schema, P extends Schema, A extends boolean>(
    method: Method,
    path: string,
    config: RouteConfig<B, Q, P, A>,
    handler: Handler<B, Q, P, A>,
  ): this {
    const requiresAuth = config.auth !== false;
    const status = config.status ?? 200;

    routeRegistry.push({
      method,
      path: `${this.prefix}${path === "/" ? "" : path}` || "/",
      tag: this.tag,
      summary: config.summary,
      description: config.description,
      auth: requiresAuth,
      roles: config.roles,
      body: config.body,
      query: config.query,
      params: config.params,
      status,
      multipart: config.multipart ?? false,
    });

    const chain: RequestHandler[] = [];
    if (requiresAuth) chain.push(authenticate);
    if (config.middleware) chain.push(...config.middleware);

    chain.push(async (req, res) => {
      if (config.roles && (!req.user || !config.roles.includes(req.user.role))) {
        throw forbidden();
      }

      const ctx = {
        req,
        res,
        body: config.body ? parseInput(config.body, req.body ?? {}) : undefined,
        query: config.query ? parseInput(config.query, req.query) : req.query,
        params: config.params ? parseInput(config.params, req.params) : req.params,
        user: req.user,
      } as RouteContext<B, Q, P, A>;

      const result = await handler(ctx);
      if (res.headersSent) return;
      if (result === undefined) {
        res.status(status === 200 ? 204 : status).end();
        return;
      }
      res.status(status).json(result);
    });

    this.router[method](path, ...chain);
    return this;
  }
}
