import type { Hono } from 'hono';
import type { Variables } from '../auth';

export type Api = Hono<{ Variables: Variables }>;
