import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { publicDnsLookup as sharedLookup, remoteEndpointAllowed as sharedAllowed, remoteSafeFetch as sharedFetch } from "./ai-outbound.mjs";

export const publicDnsLookup = sharedLookup as (resolve?: (hostname: string) => Promise<LookupAddress[]>) => LookupFunction;
export const remoteEndpointAllowed = sharedAllowed as (value: string | URL, env?: Record<string, string | undefined>) => boolean;
export const remoteSafeFetch = sharedFetch as (value: string | URL, init?: RequestInit, env?: Record<string, string | undefined>) => Promise<Response>;
