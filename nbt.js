/*
	NBT.js - a JavaScript parser for NBT archives
	by Sijmen Mulder

	I, the copyright holder of this work, hereby release it into the public
	domain. This applies worldwide.

	In case this is not legally possible: I grant anyone the right to use this
	work for any purpose, without any conditions, unless such conditions are
	required by law.
*/

(function() {
	'use strict';

	/** @exports nbt */

	var nbt = this;
	var zlib = require('zlib');

	/**
	 * A mapping from type names to NBT type numbers.
	 * {@link module:nbt.Writer} and {@link module:nbt.Reader}
	 * have correspoding methods (e.g. {@link module:nbt.Writer#int})
	 * for every type.
	 *
	 * @type Object<string, number>
	 * @see module:nbt.tagTypeNames */
	nbt.tagTypes = {
		'end': 0,
		'byte': 1,
		'short': 2,
		'int': 3,
		'long': 4,
		'float': 5,
		'double': 6,
		'byteArray': 7,
		'string': 8,
		'list': 9,
		'compound': 10,
		'intArray': 11
	};

	/**
	 * A mapping from NBT type numbers to type names.
	 *
	 * @type Object<number, string>
	 * @see module:nbt.tagTypes */
	nbt.tagTypeNames = {};
	(function() {
		for (var typeName in nbt.tagTypes) {
			if (nbt.tagTypes.hasOwnProperty(typeName)) {
				nbt.tagTypeNames[nbt.tagTypes[typeName]] = typeName;
			}
		}
	})();

	function hasGzipHeader(data) {
		return data[0] === 0x1f && data[1] === 0x8b;
	}

	/**
	 * In addition to the named writing methods documented below,
	 * the same methods are indexed by the NBT type number as well,
	 * as shown in the example below.
	 *
	 * @constructor
	 * @see module:nbt.Reader
	 *
	 * @example
	 * var writer = new nbt.Writer();
	 *
	 * // all equivalent
	 * writer.int(42);
	 * writer[3](42);
	 * writer(nbt.tagTypes.int)(42);
	 *
	 * // overwrite the second int
	 * writer.offset = 0;
	 * writer.int(999);
	 *
	 * return writer.buffer; */
	nbt.Writer = function() {
		var self = this;

		/**
		 * Will be resized on write if necessary.
		 *
		 * @type Buffer */
		this.buffer = new Buffer(0);

		/**
		 * The location in the buffer where bytes are written or read.
		 * This increases after every write, but can be freely changed.
		 * The buffer will be resized when necessary.
		 *
		 * @type number */
		this.offset = 0; // bufer is adjusted on write

		// Ensures that the buffer is large enough to write `size` bytes
		// at the current `self.offset`.
		function accommodate(size) {
			if (self.offset + size >= self.buffer.length) {
				var oldBuffer = self.buffer;
				self.buffer = new Buffer(self.offset + size);
				oldBuffer.copy(self.buffer);

				// If there's a gap between the end of the old buffer
				// and the start of the new one, we need to zero it out
				if (self.offset > oldBuffer.length) {
					self.buffer.fill(0, oldBuffer.length, self.offset);
				}
			}
		}

		function getStringSize(str) {
			// returns the byte length of an utf8 string
			var s = str.length;
			var i;

			for (i=str.length-1; i>=0; i--) {
				var code = str.charCodeAt(i);
				if (code > 0x7f && code <= 0x7ff) {
					s++;
				} else if (code > 0x7ff && code <= 0xffff) {
					s += 2;
					if (code >= 0xDC00 && code <= 0xDFFF) {
						// trail surrogate
						i--;
					}
				}
			}
			return s;
		}

		function write(dataType, size, value) {
			accommodate(size);
			self.buffer['write' + dataType](value, self.offset);
			self.offset += size;
			return self;
		}

		/**
		 * @method module:nbt.Writer#byte
		 * @param {number} value - a signed byte
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.byte] = write.bind(this, 'Int8', 1);

		/**
		 * @method module:nbt.Writer#short
		 * @param {number} value - a signed 16-bit integer
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.short] = write.bind(this, 'Int16BE', 2);
 
		/**
		 * @method module:nbt.Writer#int
		 * @param {number} value - a signed 32-bit integer
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.int] = write.bind(this, 'Int32BE', 4);

		/**
		 * @method module:nbt.Writer#float
		 * @param {number} value - a signed 32-bit float
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.float] = write.bind(this, 'FloatBE', 4);

		/**
		 * @method module:nbt.Writer#float
		 * @param {number} value - a signed 64-bit float
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.double] = write.bind(this, 'DoubleBE', 8);

		/**
		 * As JavaScript does not support 64-bit integers natively, this
		 * method takes an array of two 32-bit integers that make up the
		 * upper and lower halves of the long.
		 *
		 * @method module:nbt.Writer#long
		 * @param {Array.<number>} value - [upper, lower]
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.long] = function(value) {
			self.int(value[0]);
			self.int(value[1]);
			return self;
		};

		/**
		 * @method module:nbt.Writer#byteArray
		 * @param {Array.<number>|Buffer} value
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.byteArray] = function(value) {
			this.int(value.length);
			accommodate(value.length);
			var valueBuffer = 'copy' in value ? value : new Buffer(value);
			valueBuffer.copy(this.buffer, this.offset);
			this.offset += value.length;
			return this;
		};

		/**
		 * @method module:nbt.Writer#intArray
		 * @param {Array.<number>} value
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.intArray] = function(value) {
			this.int(value.length);
			var i;
			for (i = 0; i < value.length; i++) {
				this.int(value[i]);
			}
			return this;
		};

		/**
		 * @method module:nbt.Writer#string
		 * @param {string} value
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.string] = function(value) {
			var len = getStringSize(value);
			this.short(len);
			accommodate(len);
			this.buffer.write(value, this.offset);
			this.offset += len;

			return this;
		};

		/**
		 * @method module:nbt.Writer#list
		 * @param {Object} value
		 * @param {number} value.type - the NBT type number
		 * @param {Array} value.value - an array of values
		 * @returns {module:nbt.Writer} itself */
		this[nbt.tagTypes.list] = function(value) {
			this.byte(nbt.tagTypes[value.type]);
			this.int(value.value.length);
			var i;
			for (i = 0; i < value.value.length; i++) {
				this[value.type](value.value[i]);
			}
			return this;
		};

		/**
		 * @method module:nbt.Writer#compound
		 * @param {Object} value - a key/value map
		 * @param {Object} value.KEY
		 * @param {string} value.KEY.type - the NBT type number
		 * @param {Object} value.KEY.value - a value matching the type
		 * @returns {module:nbt.Writer} itself
		 *
		 * @example
		 * writer.compound({
		 *     foo: { type: 'int', value: 12 },
		 *     bar: { type: 'string', value: 'Hello, World!' }
		 * }); */
		this[nbt.tagTypes.compound] = function(value) {
			var self = this;
			Object.keys(value).map(function (key) {
				self.byte(nbt.tagTypes[value[key].type]);
				self.string(key);
				self[value[key].type](value[key].value);
			});
			this.byte(nbt.tagTypes.end);
			return this;
		};

		var typeName;
		for (typeName in nbt.tagTypes) {
			if (nbt.tagTypes.hasOwnProperty(typeName)) {
				this[typeName] = this[nbt.tagTypes[typeName]];
			}
		}
	};

	/**
	 * In addition to the named writing methods documented below,
	 * the same methods are indexed by the NBT type number as well,
	 * as shown in the example below.
	 *
	 * @constructor
	 * @see module:nbt.Writer
	 *
	 * @example
	 * var reader = new nbt.Reader(buf);
	 * int x = reader.int();
	 * int y = reader[3]();
	 * int z = reader[nbt.tagTypes.int](); */
	nbt.Reader = function(buffer) {
		var self = this;

		/**
		 * The current location in the buffer. Can be freely changed
		 * within the bounds of the buffer.
		 *
		 * @type number */
		this.offset = 0;

		function read(dataType, size) {
			var val = buffer['read' + dataType](self.offset);
			self.offset += size;
			return val;
		}

		/**
		 * @method module:nbt.Reader#byte
		 * @returns {number} the read byte */
		this[nbt.tagTypes.byte] = read.bind(this, 'Int8', 1);

		/**
		 * @method module:nbt.Reader#short
		 * @returns {number} the read signed 16-bit short  */
		this[nbt.tagTypes.short] = read.bind(this, 'Int16BE', 2);

		/**
		 * @method module:nbt.Reader#int
		 * @returns {number} the read signed 32-bit integer */
		this[nbt.tagTypes.int] = read.bind(this, 'Int32BE', 4);

		/**
		 * @method module:nbt.Reader#float
		 * @returns {number} the read signed 32-bit float */
		this[nbt.tagTypes.float] = read.bind(this, 'FloatBE', 4);

		/**
		 * @method module:nbt.Reader#double
		 * @returns {number} the read signed 64-bit float */
		this[nbt.tagTypes.double] = read.bind(this, 'DoubleBE', 8);

		/**
		 * As JavaScript does not not natively support 64-bit
		 * integers, the value is returned as an array of two
		 * 32-bit integers, the upper and the lower.
		 *
		 * @method module:nbt.Reader#long
		 * @returns {Array.<number>} [upper, lower] */
		this[nbt.tagTypes.long] = function() {
			return [this.int(), this.int()];
		};

		/**
		 * @method module:nbt.Reader#byteArray
		 * @returns {Array.<number>} the read array */
		this[nbt.tagTypes.byteArray] = function() {
			var length = this.int();
			var bytes = [];
			var i;
			for (i = 0; i < length; i++) {
				bytes.push(this.byte());
			}
			return bytes;
		};

		/**
		 * @method module:nbt.Reader#intArray
		 * @returns {Array.<number>} the read array of 32-bit ints */
		this[nbt.tagTypes.intArray] = function() {
			var length = this.int();
			var ints = [];
			var i;
			for (i = 0; i < length; i++) {
				ints.push(this.int());
			}
			return ints;
		};

		/**
		 * @method module:nbt.Reader#string
		 * @returns {string} the read string */
		this[nbt.tagTypes.string] = function() {
			var length = this.short();
			var val = buffer.toString('utf8', this.offset, this.offset + length);
			this.offset += length;
			return val;
		};

		/**
		 * @method module:nbt.Reader#list
		 * @returns {{type: string, value: Array}}
		 *
		 * @example
		 * reader.list();
		 * // -> { type: 'string', values: ['foo', 'bar'] } */
		this[nbt.tagTypes.list] = function() {
			var type = this.byte();
			var length = this.int();
			var values = [];
			var i;
			for (i = 0; i < length; i++) {
				values.push(this[type]());
			}
			return { type: nbt.tagTypeNames[type], value: values };
		};

		/**
		 * @method module:nbt.Reader#compound
		 * @returns {Object.<string, { type: string, value }>}
		 *
		 * @example
		 * reader.compound();
		 * // -> { foo: { type: int, value: 42 },
		 * //      bar: { type: string, value: 'Hello! }} */
		this[nbt.tagTypes.compound] = function() {
			var values = {};
			while (true) {
				var type = this.byte();
				if (type === nbt.tagTypes.end) {
					break;
				}
				var name = this.string();
				var value = this[type]();
				values[name] = { type: nbt.tagTypeNames[type], value: value };
			}
			return values;
		};

		var typeName;
		for (typeName in nbt.tagTypes) {
			if (nbt.tagTypes.hasOwnProperty(typeName)) {
				this[typeName] = this[nbt.tagTypes[typeName]];
			}
		}
	};

	/**
	 * @param {Object} value - a named compound
	 * @param {string} value.name - the top-level name
	 * @param {Object} value.value - a compound
	 * @returns {Buffer}
	 *
	 * @see module:nbt.parseUncompressed
	 * @see module:nbt.Writer#compound
	 *
	 * @example
	 * nbt.writeUncompressed({
	 *     name: 'My Level',
	 *     value: {
	 *         foo: { type: int, value: 42 },
	 *         bar: { type: string, value: 'Hi!' }
	 *     }
	 * }); */
	this.writeUncompressed = function(value) {
		var writer = new nbt.Writer();

		writer.byte(nbt.tagTypes.compound);
		writer.string(value.name);
		writer.compound(value.value);

		return writer.buffer;
	};

	/**
	 * @param {Buffer} data - an uncompressed NBT archive
	 * @returns {{name: string, value: Object.<string, Object>}}
	 *     a named compound
	 *
	 * @see module:nbt.parse
	 * @see module:nbt.writeUncompressed
	 *
	 * @example
	 * nbt.readUncompressed(buf);
	 * // -> { name: 'My Level',
	 * //      value: { foo: { type: int, value: 42 },
	 * //               bar: { type: string, value: 'Hi!' }}} */
	this.parseUncompressed = function(data) {
		var buffer = new Buffer(data);
		var reader = new nbt.Reader(buffer);

		var type = reader.byte();
		if (type !== nbt.tagTypes.compound) {
			throw new Error('Top tag should be a compound');
		}

		return {
			name: reader.string(),
			value: reader.compound()
		};
	};

	/**
	 * @callback parseCallback
	 * @param {Object} error
	 * @param {Object} result - a named compound
	 * @param {string} result.name - the top-level name
	 * @param {Object} result.value - the top-level compound */

	/**
	 * This accepts both gzipped and uncompressd NBT archives.
	 * If the archive is uncompressed, the callback will be
	 * called directly from this method. For gzipped files, the
	 * callback is async.
	 *
	 * @param {Buffer} data - gzipped or uncompressed data
	 * @param {parseCallback} callback
	 *
	 * @see module:nbt.parseUncompressed
	 * @see module:nbt.Reader#compound
	 *
	 * @example
	 * nbt.parse(buf, function(error, results) {
	 *     if (error) {
	 *         throw error;
	 *     }
	 *     console.log(result.name);
	 *     console.log(result.value.foo);
	 * }); */
	this.parse = function(data, callback) {
		var self = this;

		if (hasGzipHeader(data)) {
			zlib.gunzip(data, function(error, uncompressed) {
				if (error) {
					callback(error, data);
				} else {
					callback(null, self.parseUncompressed(uncompressed));
				}
			});
		} else {
			callback(null, self.parseUncompressed(data));
		}
	};
}).apply(exports || (window.nbt = {}));
