// a general purpose cache that allows us to save the results 

import * as assert from "assert";
import { Transaction } from ".";

enum CachEntryType {
    value,
    promise
}
type CacheEntryPromise<T> = {
    type: CachEntryType.promise,
    value: Promise<T>,
    fulfill: () => Promise<T>
}
type CacheEntryValue<T> = {
    type: CachEntryType.value,
    value: T,
    fulfill: () => Promise<T>
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
    async validateCache(onValid: () => void) {
        const lastMutationIndex = this.txn._tn.allOperations?.length || 0;
        let maxIter = 1000;
        while (maxIter-- > 0) {
            await Promise.all(
                Array.from(this.cache.entries()).map(async ([key, entry]) => {
                    const cacheEntryValue = await entry.value;
                    const currentValue = await entry.fulfill();
                    if (!this.areEqual(cacheEntryValue, currentValue)) {
                        this.cache.set(key, {
                            type: CachEntryType.value,
                            value: currentValue,
                            fulfill: entry.fulfill
                        });
                        throw new UnresolvedValueError(Promise.resolve());
                    }
                })
            )
            if ((this.txn._tn.allOperations?.length || 0) === lastMutationIndex) {
                onValid();
                return;
            }
        }
        throw new Error("Could not validate cache within 1000 iterations");
    }
}