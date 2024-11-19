//based on https://github.com/apple/foundationdb/wiki/Everything-about-GetMappedRange

import { tuple, TupleItem } from ".";
import { GetSubspace } from "./subspace";


export class MappedRange<KEY_OUT, VAL_OUT> {
    readonly target;
    private spec;
    constructor(args: {
        target: GetSubspace<any, KEY_OUT, any, VAL_OUT>,
        spec: Array<MappedRange.MappedRangeTupleElement>
    }) {
        this.target = args.target;
        this.spec = args.spec;
    }
    toTuple() {
        return tuple.pack(
            [
                ...tuple.unpack(this.target.getSubspace().prefix),
                ...this.spec.map(v => {
                    switch (v.type) {
                        case MappedRange.MappedRangeTupleElementType.key:
                            return `{K[${v.index}]}`
                        case MappedRange.MappedRangeTupleElementType.value:
                            return `{V[${v.index}]}`
                        default:
                            //need to escape braces per spec
                            v satisfies MappedRange.MappedRangeTupleElementLiteral;
                            if (typeof v.value === "string")
                                return v.value.replaceAll("{", "{{")
                                    .replace("}", "}}");
                            return v.value
                    }
                }),
                //unable to get mapped range requests to work as per the spec without adding
                //in the ...
                //the ... is supposed to signal a starts with range read (rather than looking up a single key/value)
                //but passing without the ... returns an empty array
                //the spec mentions that the java binsings don't support get requests, only get range requests
                //so assumedly the state of the c binding is the same
                '{...}'
            ]
        )
    }
}


export namespace MappedRange {
    export enum MappedRangeTupleElementType {
        key = 1,
        value = 2,
        literal = 3,
    }
    export interface MappedRangeTupleElementKey {
        type: MappedRangeTupleElementType.key,
        index: number
    }
    export interface MappedRangeTupleElementValue {
        type: MappedRangeTupleElementType.value,
        index: number
    }
    export interface MappedRangeTupleElementLiteral {
        type: MappedRangeTupleElementType.literal,
        value: TupleItem
    }
    export type MappedRangeTupleElement = MappedRangeTupleElementKey | MappedRangeTupleElementValue | MappedRangeTupleElementLiteral
}
