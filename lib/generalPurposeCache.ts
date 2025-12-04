// a general purpose cache that allows us to save the results 

import * as assert from "assert";
import { FDBError, Transaction } from ".";

enum CachEntryType {
    value,
    promise
}
type CacheEntryPromise<T> = {
    type: CachEntryType.promise,
    value: Promise<T>,
    fulfill: () => Promise<T>,
    flags?: EnumCacheEntryFlags
}
enum EnumCacheEntryFlags {
    isCreate = 1
}
type CacheEntryValue<T> = {
    type: CachEntryType.value,
    value: T,
    fulfill: () => Promise<T>,
    flags?: EnumCacheEntryFlags
}

type CacheEntry<T> = CacheEntryPromise<T> | CacheEntryValue<T>;

export class UnresolvedValueError extends Error {
    constructor(readonly promise: Promise<any>) {
        super("Transaction value not yet resolved")
    }
}
// of certain async calls and then validate them in a synchronous fashion later
export class GeneralPurposeCache {
    private cache = new Map<string, CacheEntry<any>>();
    constructor(private txn: Transaction<any, any, any, any>) {

    }

    private areEqual(a: any, b: any): boolean {
        try {
            assert.deepStrictEqual(a, b);
            return true;
        } catch (e) {
            return false;
        }
    }
    addCreate(key: string, fulfill: () => Promise<any>) {
        const existing = this.cache.get(key);
        const value = undefined;
        if (existing && !this.areEqual(existing.value, value)) {
            throw new Error("Cache entry already present with a value");
        }
        this.cache.set(key, {
            type: CachEntryType.value,
            value,
            fulfill,
            flags: EnumCacheEntryFlags.isCreate
        });
    }
    get<T>(
        //how do we identify this cache entry
        cacheKey: string,
        fulfill: () => Promise<T>
    ): T {
        const existing = this.cache.get(cacheKey);
        if (existing) {
            if (existing.type === CachEntryType.value) {
                return existing.value;
            }
            throw new UnresolvedValueError(existing.value);
        }
        const promise = fulfill();
        const entry: CacheEntryPromise<T> = {
            type: CachEntryType.promise,
            value: promise,
            fulfill
        };
        this.cache.set(cacheKey, entry);
        throw new UnresolvedValueError(promise.then(value => {
            (entry as any as CacheEntryValue<T>).type = CachEntryType.value;
            (entry as any as CacheEntryValue<T>).value = value;
            return value;
        }));
    }
    async validateCache(): Promise<boolean> {
        const results = await Promise.all(
            Array.from(this.cache.entries()).map(async ([key, entry]) => {
                const cacheEntryValue = await entry.value;
                const currentValue = await entry.fulfill();
                if (!this.areEqual(cacheEntryValue, currentValue)) {
                    this.cache.set(key, {
                        type: CachEntryType.value,
                        value: currentValue,
                        fulfill: entry.fulfill
                    });
                    if (entry.flags !== undefined && (entry.flags & EnumCacheEntryFlags.isCreate) !== 0) {
                        //we want this to be caught by the main transaction control loop,
                        //as the key may have been constructed outside of the control loop that uses this cache
                        throw new FDBError("Fake conflict (create)", 1020)
                    }
                    return false

                }
                return true;
            })
        )
        return results.every(r => r);
    }
}