import { Operations, Transaction } from "."
import { asBuf } from "./util"

export enum CacheKeyType {
    get,
    getRangeAllStartsWith
}

export enum CacheType {
    promise,
    resolvedValue
}

export type CacheValueResolvedContents<T> = {
    resolved: T,
    lastMutationIndex: number | null
}

export type CacheValueResolved<T> = {
    type: CacheType.resolvedValue,
    contents: CacheValueResolvedContents<T>
}
export type CacheValuePromise<T> = {
    type: CacheType.promise,
    promise: Promise<CacheValueResolvedContents<T>>
}
export type CacheValue<T> = CacheValueResolved<T> | CacheValuePromise<T>

export class UnresolvedValueError extends Error {
    constructor(readonly promise: Promise<any>) {
        super("Transaction value not yet resolved")
    }
}

export type GetCacheValueEntry = {
    key: Buffer,
    value: Buffer | undefined
}


export class GeneralPurposeCache {
    private getCache: Map<string, CacheValue<GetCacheValueEntry>> = new Map();
    private getRangeAllStartsWithCache: Map<string, CacheValue<Array<[Buffer, Buffer]>>> = new Map();
    constructor(private txn: Transaction<any, any, any, any>) {

    }
    //for clearRange, just return true, will cause false positives but thats ok
    getLastMutationIndexForKey(bufKey: Buffer): number | null {
        return this.txn._tn.allOperations?.findLastIndex(op => {
            return (op.op === "set" || op.op === "clear") && asBuf(op.bufKey).compare(bufKey) === 0
                || op.op === "clearRange"
        }) || null;
    }
    getLastMutationIndexForGetRangeAllStartsWith(bufKey: Buffer): number | null {
        return this.txn._tn.allOperations?.findLastIndex(op => {
            if (op.op === "set" || op.op === "clear") {
                //does the key start with bufKey?
                return asBuf(op.bufKey).slice(0, bufKey.length).compare(bufKey) === 0
            }
            else if (op.op === "clearRange") {
                return true
            }
        }) || null;
    }
    insertGetRangeAllStartsWithPromise(args: {
        hexKey: string,
        bufKey: Buffer,
        promise: Promise<Array<[Buffer, Buffer]>>
    }) {
        const { hexKey, bufKey } = args;
        //what is the last index that mutates this key
        const lastMutationIndex = this.getLastMutationIndexForGetRangeAllStartsWith(bufKey);
        const promise = args.promise
            .then((value): CacheValueResolvedContents<Array<[Buffer, Buffer]>> => {
                return {
                    lastMutationIndex,
                    resolved: value
                }
            })
        const cvp: CacheValuePromise<Array<[Buffer, Buffer]>> = {
            type: CacheType.promise,
            promise
        }
        this.getRangeAllStartsWithCache.set(hexKey, cvp)
        return promise
    }

    insertGetPromise(args: {
        hexKey: string,
        bufKey: Buffer,
        promise: Promise<Buffer | undefined>
    }) {
        const { hexKey, bufKey } = args;
        //what is the last index that mutates this key
        const lastMutationIndex = this.getLastMutationIndexForKey(bufKey);
        const promise = args.promise
            .then((value): CacheValueResolvedContents<GetCacheValueEntry> => {
                return {
                    lastMutationIndex,
                    resolved: {
                        key: bufKey,
                        value
                    }
                }
            })
        const cvp: CacheValuePromise<GetCacheValueEntry> = {
            type: CacheType.promise,
            promise
        }
        this.getCache.set(hexKey, cvp)
        return promise
    }
    getGetCacheEntry(hexKey: string, bufKey: Buffer, notFound: () => Promise<Buffer | undefined>): CacheValueResolved<GetCacheValueEntry> {
        const ret = this.getCache.get(hexKey);
        if (ret) {
            switch (ret.type) {
                case CacheType.resolvedValue:
                    return ret;
                case CacheType.promise:
                    throw new UnresolvedValueError(ret.promise);
                default:
                    ret satisfies never;
                    throw new Error("Invalid cache entry type");
            }
        }
        throw new UnresolvedValueError(
            this.insertGetPromise({
                hexKey,
                bufKey,
                promise: notFound()
            }).then(cv => {
                //insert into get cache too, lastModifiedIndex may be innaccurate, but will catch any subsequent updates on validate
                //an only risks being a little noisy
                this.getCache.set(cv.resolved.key.toString("hex"), {
                    type: CacheType.resolvedValue,
                    contents: {
                        resolved: {
                            key: cv.resolved.key,
                            value: cv.resolved.value
                        },
                        lastMutationIndex: cv.lastMutationIndex
                    }
                })
            })
        )
    }
    getRangeAllStartsWithCacheEntry(hexKey: string, bufKey: Buffer, notFound: () => Promise<Array<[Buffer, Buffer]>>): CacheValueResolved<Array<[Buffer, Buffer]>> {
        const ret = this.getRangeAllStartsWithCache.get(hexKey);
        if (ret) {
            switch (ret.type) {
                case CacheType.resolvedValue:
                    return ret;
                case CacheType.promise:
                    throw new UnresolvedValueError(ret.promise);
                default:
                    ret satisfies never;
                    throw new Error("Invalid cache entry type");
            }
        }
        throw new UnresolvedValueError(
            this.insertGetRangeAllStartsWithPromise({
                hexKey,
                bufKey,
                promise: notFound()
            })
        )
    }
    validateCache() {
        const errorRowsGet = Array.from(this.getCache.entries()).filter(([key, value]) => {
            if (value.type === CacheType.promise)
                throw new Error("Cannot validate cache with unresolved promises");
            const lastMutationIndex = this.getLastMutationIndexForKey(
                value.contents.resolved.key
            )
            if (value.contents.lastMutationIndex !== lastMutationIndex) {
                //cache is invalid
                this.getCache.delete(key);
                return true;
            }
        });
        const errorRowsGetRangeAllStartsWith = Array.from(this.getRangeAllStartsWithCache.entries())
            .map(([key, value]) => {
                if (value.type === CacheType.promise)
                    throw new Error("Cannot validate cache with unresolved promises");
                //need to check every value in the array
                return value.contents.resolved.filter(([bufKey, _]) => {
                    const lastMutationIndex = this.getLastMutationIndexForGetRangeAllStartsWith(
                        bufKey
                    )
                    if (value.contents.lastMutationIndex !== lastMutationIndex) {
                        //cache is invalid
                        this.getRangeAllStartsWithCache.delete(key);
                        return true;
                    }
                    return false;
                })
            }).flat();
        return errorRowsGet.length === 0 && errorRowsGetRangeAllStartsWith.length === 0;
    }
}