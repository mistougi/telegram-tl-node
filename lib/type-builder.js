//       telegram-tl-node
//
//       Copyright 2014 Enrico Stara 'enrico.stara@gmail.com'
//       Released under the Simplified BSD License
//       https://github.com/enricostara/telegram-tl-node

//      TypeBuilder class
//
// This class can build dynamically a `TypeObject` concrete sub-class
// parsing `TL-Schema` for both `MTProto` and `Telegram API`

// Export the class
module.exports = exports = TypeBuilder;

// Export the method
exports.buildTypes = buildTypes;
exports.registerType = registerType;
exports.retrieveType = retrieveType;

// Import dependencies
var util = require('util');
var getLogger = require('get-log');
var logger = getLogger('TypeBuilder');
var TypeObject = require('./type-object');

// Compile a reg exp to resolve Type declaration in TL-Schema
var typeResolver = /^(\w+)(<(\w+)>)?$/;

// The constructor requires the following params:
//      `module`: the module name where add this new Type (class or function),
//      `tlSchema`: the TypeLanguage schema that describes the Type (class or function),
//      `messageWrapperType`: message-wrapper type to be used by the Type function, undefined in case of Type class
function TypeBuilder(module, tlSchema, messageWrapperType) {
    this.module = module;
    if (!this.module) {
        logger.warn(' Target \'module\' parameter is mandatory!');
        console.trace();
        return;
    }
    this.tlSchema = tlSchema;
    if (!this.tlSchema) {
        logger.warn('\'tlSchema\' parameter is mandatory!');
        return;
    }
    this._methods = [];

    // Check if is required creating a function
    if (messageWrapperType) {
        this._type = this.buildTypeFunction(messageWrapperType);
    } else {
        this._type = this.buildTypeConstructor();
    }
}

// Return the built type
TypeBuilder.prototype.getType = function () {
    return this._type;
};

// Return the type function payload if expected
TypeBuilder.prototype.getFunctionPayload = function () {
    return this._functionPayload;
};

// Return the required internal module/class
TypeBuilder.prototype.require = function (module) {
    var required = require('../index')[module];
    return  required;
};


// This function builds a new `TypeLanguage` function parsing the `TL-Schema method`
TypeBuilder.prototype.buildTypeFunction = function (messageWrapperType) {
    var methodName = this.tlSchema.method;
    // Start creating the body of the new Type function
    var body =
        '\tvar start = new Date().getTime();\n' +
        '\tvar self = arguments.callee;\n' +
        '\tvar callback = options.callback;\n' +
        '\tvar conn = options.conn;\n' +
        '\tif (!conn) {\n' +
        '\t\tvar msg = \'The \\\'conn\\\' option is missing, it\\\'s mandatory\';\n' +
        '\t\tself.logger.warn(msg);\n' +
        '\t\tif(callback) callback({code: \'EILLEGALARG\', msg: msg});\n' +
        '\t\treturn;\n' +
        '\t}\n';
    body +=
        '\tvar reqPayload = new self.PayloadType(options);\n' +
        '\tvar reqMsg = new self.MessageWrapperType({message: reqPayload.serialize()});\n';
    body +=
        '\tconn.connect(function (ex1) {\n' +
        '\t\tif(ex1) {\n' +
        '\t\t\tself.logger.error(\'Unable to connect: %s \', ex1);\n' +
        '\t\t\tif(callback) callback(ex1);\n' +
        '\t\t\treturn;\n' +
        '\t\t}\n' +
        '\t\tconn.write(reqMsg.serialize(), function (ex2) {\n' +
        '\t\t\tif(ex2) {\n' +
        '\t\t\t\tself.logger.error(\'Unable to write: %s \', ex2);\n' +
        '\t\t\t\tif(callback) callback(ex2);\n' +
        '\t\t\t\treturn;\n' +
        '\t\t\t}\n' +
        '\t\t\tconn.read(function (ex3, response) {\n' +
        '\t\t\t\tif(ex3) {\n' +
        '\t\t\t\t\tself.logger.error(\'Unable to read: %s \', ex3);\n' +
        '\t\t\t\t\tif(callback) callback(ex3);\n' +
        '\t\t\t\t\treturn;\n' +
        '\t\t\t\t}\n' +
        '\t\t\t\ttry {\n' +
        '\t\t\t\t\tvar resMsg = new self.MessageWrapperType({buffer: response}).deserialize();\n' +
        '\t\t\t\t\tresMsg = resMsg.getMessage();\n' +
        '\t\t\t\t\tvar Type = self.retrieveType(resMsg);\n' +
        '\t\t\t\t\tvar resObj = new Type({buffer: resMsg});\n' +
        '\t\t\t\t\tresObj.deserialize();\n' +
        '\t\t\t\t\tvar duration = new Date().getTime() - start;\n' +
        '\t\t\t\t\tif(self.logger.isDebugEnabled()) self.logger.debug(\'Executed in %sms\', duration);\n' +
        '\t\t\t\t\tif(callback) callback(null, resObj, duration);\n' +
        '\t\t\t\t} catch(ex4) {\n' +
        '\t\t\t\t\tself.logger.error(\'Unable to deserialize response due to %s \', ex4);\n' +
        '\t\t\t\t\tif(callback) callback(ex4);\n' +
        '\t\t\t\t}\n' +
        '\t\t\t});\n' +
        '\t\t});\n' +
        '\t});';
    if (logger.isDebugEnabled()) {
        logger.debug('Body for %s type function:', methodName);
        logger.debug('\n' + body);
    }
    /*jshint evil:true */
    // Create the new Type function
    var typeFunction = new Function('options', body);
    typeFunction.retrieveType = retrieveType;
    // Create the function payload class re-calling TypeBuilder constructor.
    typeFunction.PayloadType = new TypeBuilder(this.module, this.tlSchema).getType();
    typeFunction.MessageWrapperType = messageWrapperType;
    typeFunction.logger = getLogger(this.module + '.' + methodName);
    return typeFunction;
};

// This function builds a new `TypeLanguage` class (a `TypeObject` sub-class)
// parsing the `TL-Schema constructor`
TypeBuilder.prototype.buildTypeConstructor = function () {
    // Start creating the body of the new Type constructor, first calling super()
    var body =
        '\tvar super_ = this.constructor.super_.bind(this);\n' +
        '\tvar opts = options ? options : {};\n' +
        '\tthis.constructor.util._extend(this, opts.props);\n' +
        '\tsuper_(opts.buffer, opts.offset);\n';
    // Init fields
    var typeName = this.tlSchema.method ?
        this.tlSchema.method :
        (this.tlSchema.predicate.charAt(0).toUpperCase() + this.tlSchema.predicate.slice(1));

    var buffer = new Buffer(4);
    buffer.writeUInt32LE(this.tlSchema.id, 0, true);
    var typeId = buffer.toString('hex');
    var fullTypeName = this.module + '.' + typeName;
    body +=
        '\tthis.id = "' + typeId + '";\n' +
        '\tthis.typeName = "' + fullTypeName + '";\n';
    body += this._buildSerialize();
    body += this._buildDeserialize();
    // Add to body all the read/write methods
    for (var i = 0; i < this._methods.length; i++) {
        body += this._methods[i];
    }
    if (logger.isDebugEnabled()) {
        logger.debug('Body for %s type constructor:', typeName);
        logger.debug('\n' + body);
    }
    /*jshint evil:true */
    // Create the new Type sub-class of TypeObject
    var typeConstructor = new Function('options', body);
    typeConstructor.id = typeId;
    typeConstructor.typeName = fullTypeName;
    typeConstructor.require = this.require;
    typeConstructor.util = require('util');
    typeConstructor.logger = getLogger(fullTypeName);
    util.inherits(typeConstructor, TypeObject);
    return registerType(typeConstructor);
};

// Create the `serialize()` method
TypeBuilder.prototype._buildSerialize = function () {
    var body =
        '\tthis.serialize = function serialize () {\n' +
        '\t\tvar super_serialize = this.constructor.super_.prototype.serialize.bind(this);\n' +
        '\t\tif (!super_serialize()) {\n' +
        '\t\t\treturn false;\n' +
        '\t\t}\n';
    // Parse the `TL-Schema params`
    if (this.tlSchema.params) {
        for (var i = 0; i < this.tlSchema.params.length; i++) {
            var param = this.tlSchema.params[i];
            var type = param.type.match(typeResolver);
            var typeName = type[1];
            // Manage Object type
            if (typeName.charAt(0) == typeName.charAt(0).toUpperCase()) {
                body +=
                    '\t\tthis._writeBytes(this.' + param.name + '.serialize());\n';
            }
            // Manage primitive type
            else {
                typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);
                body +=
                    '\t\tthis.' + this._buildWriteProperty(param.name, typeName) + '();\n';
            }
        }
    }
    body +=
        '\t\treturn this.retrieveBuffer();\n' +
        '\t}\n';
    return body;
};

// Create the `write[property]()` method
TypeBuilder.prototype._buildWriteProperty = function (propertyName, typeName) {
    var functionName = 'write' + propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
    var body =
        '\tthis.' + functionName + ' = function ' + functionName + '() {\n';
    body +=
        '\t\tthis.constructor.logger.debug(\'write \\\'%s\\\' = %s\', \'' + propertyName + '\', this.' + propertyName +
        ('Bytes' == typeName ? '.toString(\'hex\')' : '') + ');\n';
    body +=
        '\t\tthis.write' + typeName + '(this.' + propertyName + ');\n';
    body +=
        '\t};\n';
    this._methods.push(body);
    return functionName;
};

// create the `deserialize()` method
TypeBuilder.prototype._buildDeserialize = function () {
    var body =
        '\tthis.deserialize = function deserialize () {\n' +
        '\t\tvar super_deserialize = this.constructor.super_.prototype.deserialize.bind(this);\n' +
        '\t\tif (!super_deserialize()) {\n' +
        '\t\t\treturn false;\n' +
        '\t\t}\n';
    // Parse the `TL-Schema params`
    if (this.tlSchema.params) {
        for (var i = 0; i < this.tlSchema.params.length; i++) {
            var param = this.tlSchema.params[i];
            var type = param.type.match(typeResolver);
            var typeName = type[1];
            if (!type[3]) {
                // Manage Object type
                if (typeName.charAt(0) == typeName.charAt(0).toUpperCase()) {
                    typeName = 'Type' + typeName;
                    body +=
                        '\t\tvar ' + typeName + ' = this.constructor.require(\'' + typeName + '\');\n' +
                        '\t\tvar obj = new ' + typeName + '({buffer: this._buffer, offset: this.getReadOffset()}).deserialize();\n' +
                        '\t\tif (obj) {\n' +
                        '\t\t\tthis.' + param.name + ' = obj;\n' +
                        '\t\t\tthis._readOffset += obj.getReadOffset()\n' +
                        '\t\t}\n';
                }
                // Manage primitive type
                else {
                    typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);
                    body +=
                        '\t\tthis.' + this._buildReadProperty(param.name, typeName) + '();\n';
                }
            }
            // Manage generic type
            else {
                var typeParam = type[3];
                typeName = 'Type' + typeName;
                body +=
                    '\t\tvar ' + typeName + ' = this.constructor.require(\'' + typeName + '\');\n' +
                    '\t\tvar obj = new ' + typeName + '({type: \'' + typeParam + '\', ' +
                    'buffer: this._buffer, offset: this.getReadOffset()}).deserialize();\n' +
                    '\t\tif (obj) {\n' +
                    '\t\t\tthis.' + param.name + ' = obj;\n' +
                    '\t\t\tthis._readOffset += obj.getReadOffset();\n' +
                    '\t\t}\n';
            }
        }
    }
    // check if all the buffer has been read
    body +=
        '\t\tif(this._readOffset !== this._buffer.length) {\n' +
        '\t\t\tthrow new Error(\'De-serialization failed! readOffset(\' + this._readOffset + \') ' +
            '!= buffer.length(\' + this._buffer.length + \')\');\n' +
        '\t\t}\n';

    body +=
        '\t\treturn this;\n' +
        '\t}\n';
    return body;
};

// Create the `read[property]()` method
TypeBuilder.prototype._buildReadProperty = function (propertyName, typeName) {
    var functionName = 'read' + (propertyName.charAt(0).toUpperCase() + propertyName.slice(1));
    var body =
        '\tthis.' + functionName + ' = function ' + functionName + '() {\n';
    body +=
        '\t\tthis.' + propertyName + ' = this.read' + typeName + '();\n';
    body +=
        '\t\tthis.constructor.logger.debug(\'read \\\'%s\\\' = %s, offset = %s\', \'' + propertyName + '\', this.' + propertyName +
        ('Bytes' == typeName ? '.toString(\'hex\')' : '') + ', this._readOffset);\n';
    body +=
        '\t};\n';
    this._methods.push(body);
    return functionName;
};

// type cache
var types = {};

// Register a Type constructor
function registerType(type) {
    if (logger.isDebugEnabled()) logger.debug('Register Type \'%s\' with id [%s]', type.typeName, type.id);
    return (types[type.id] = type);
}

// Retrieve a Type constructor
function retrieveType(buffer) {
    var typeId = buffer.slice(0, 4).toString('hex');
    var type = types[typeId];
    if (logger.isDebugEnabled()) logger.debug('Retrive Type \'%s\' with id [%s]', type.typeName, typeId);
    return type;
}

// Types builder
function buildTypes(schemas, types, targetModule, isMethodType) {
    for (var i = 0; i < schemas.length; i++) {
        var type = schemas[i];
        if (types.lastIndexOf(type[isMethodType ? 'method' : 'type']) >= 0) {
            var typeName = isMethodType ? type.method : (type.predicate.charAt(0).toUpperCase() + type.predicate.slice(1));
            var builder = new TypeBuilder(targetModule._id,  type, isMethodType);
            targetModule[typeName] = builder.getType();
            targetModule['_' + typeName] = builder.getFunctionPayload();
        }
    }
}