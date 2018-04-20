/*
 * FoundationDB Node.js API
 * Copyright (c) 2012 FoundationDB, LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

"use strict";

var toBuffer = function(obj) {
	return Buffer.from(obj);
};

toBuffer.fromByteLiteral = function(str) {
	if(typeof str === 'string') {
		var buf = new Buffer(str.length);
		for(var i = 0; i < str.length; ++i) {
			if(str[i] > 255)
				throw new RangeError('fromByteLiteral string argument cannot have codepoints larger than 1 byte');
			buf[i] = str.charCodeAt(i);
		}
		return buf;
	}
	else
		throw new TypeError('fromByteLiteral function expects a string');
};

toBuffer.toByteLiteral = function(buf) {
	if(Buffer.isBuffer(buf))
		return String.fromCharCode.apply(null, buf);
	else
		throw new TypeError('toByteLiteral function expects a buffer');
};

toBuffer.printable = function(buf) {
	buf = toBuffer(buf);
	var out = '';
	for(var i = 0; i < buf.length; ++i) {
		if(buf[i] >= 32 && buf[i] < 127 && buf[i] !== 92)
			out += String.fromCharCode(buf[i]);
		else if(buf[i] === 92)
			out += '\\\\';
		else {
			var str = buf[i].toString(16);
			out += '\\x';
			if(str.length == 1)
				out += '0';
			out += str;
		}
	}

	return out;
};

module.exports = toBuffer;
