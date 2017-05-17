/**
 * RBC twigjs render
 *
 * @copyright 2011-2016 John Roepke and the Twig.js Contributors
 * @license   Available under the BSD 2-Clause License
 * @link      https://github.com/twigjs/twig.js
 */

var Twig = {
    VERSION: '0.0.4',
    _is: function (type, obj) {
        var clas = Object.prototype.toString.call(obj).slice(8, -1);
        return obj !== undefined && obj !== null && clas === type;
    }
};


// ## twig.core.js
//
// This file handles template level tokenizing, compiling and parsing.
(function (Twig) {
    "use strict";

    Twig.trace = false;
    Twig.debug = false;

    Twig.placeholders = {
        parent: "{{|PARENT|}}"
    };

    Twig.forEach = function (arr, callback, thisArg) {
        if (Array.prototype.forEach) {
            return arr.forEach(callback, thisArg);
        }

        var T, k;

        if (arr == null) {
            throw new TypeError(" this is null or not defined");
        }

        // 1. Let O be the result of calling ToObject passing the |this| value as the argument.
        var O = Object(arr);

        // 2. Let lenValue be the result of calling the Get internal method of O with the argument "length".
        // 3. Let len be ToUint32(lenValue).
        var len = O.length >>> 0; // Hack to convert O.length to a UInt32

        // 4. If IsCallable(callback) is false, throw a TypeError exception.
        // See: http://es5.github.com/#x9.11
        if ({}.toString.call(callback) != "[object Function]") {
            throw new TypeError(callback + " is not a function");
        }

        // 5. If thisArg was supplied, let T be thisArg; else let T be undefined.
        if (thisArg) {
            T = thisArg;
        }

        // 6. Let k be 0
        k = 0;

        // 7. Repeat, while k < len
        while (k < len) {

            var kValue;

            // a. Let Pk be ToString(k).
            //   This is implicit for LHS operands of the in operator
            // b. Let kPresent be the result of calling the HasProperty internal method of O with argument Pk.
            //   This step can be combined with c
            // c. If kPresent is true, then
            if (k in O) {

                // i. Let kValue be the result of calling the Get internal method of O with argument Pk.
                kValue = O[k];

                // ii. Call the Call internal method of callback with T as the this value and
                // argument list containing kValue, k, and O.
                callback.call(T, kValue, k, O);
            }
            // d. Increase k by 1.
            k++;
        }
        // 8. return undefined
    };

    Twig.merge = function (target, source, onlyChanged) {
        Twig.forEach(Object.keys(source), function (key) {
            if (onlyChanged && !(key in target)) {
                return;
            }

            target[key] = source[key]
        });

        return target;
    };

    /**
     * Exception thrown by twig.js.
     */
    Twig.Error = function (message) {
        this.message = message;
        this.name = "TwigException";
        this.type = "TwigException";
    };

    /**
     * Get the string representation of a Twig error.
     */
    Twig.Error.prototype.toString = function () {
        var output = this.name + ": " + this.message;

        return output;
    };

    /**
     * Wrapper for logging to the console.
     */
    Twig.log = {
        trace: function () {
            if (Twig.trace && console) {
                console.log(Array.prototype.slice.call(arguments));
            }
        },
        debug: function () {
            if (Twig.debug && console) {
                console.log(Array.prototype.slice.call(arguments));
            }
        }
    };


    if (typeof console !== "undefined") {
        if (typeof console.error !== "undefined") {
            Twig.log.error = function() {
                console.error.apply(console, arguments);
            }
        } else if (typeof console.log !== "undefined") {
            Twig.log.error = function() {
                console.log.apply(console, arguments);
            }
        }
    } else {
        Twig.log.error = function() {};
    }

    /**
     * Wrapper for child context objects in Twig.
     *
     * @param {Object} context Values to initialize the context with.
     */
    Twig.ChildContext = function(context) {
        var ChildContext = function ChildContext() {};
        ChildContext.prototype = context;
        return new ChildContext();
    };

    /**
     * Container for methods related to handling high level template tokens
     *      (for example: {{ expression }}, {% logic %}, {# comment #}, raw data)
     */
    Twig.token = {};

    /**
     * Token types.
     */
    Twig.token.type = {
        output: 'output',
        logic: 'logic',
        comment: 'comment',
        raw: 'raw',
        output_whitespace_pre: 'output_whitespace_pre',
        output_whitespace_post: 'output_whitespace_post',
        output_whitespace_both: 'output_whitespace_both',
        logic_whitespace_pre: 'logic_whitespace_pre',
        logic_whitespace_post: 'logic_whitespace_post',
        logic_whitespace_both: 'logic_whitespace_both'
    };

    /**
     * What characters start "strings" in token definitions. We need this to ignore token close
     * strings inside an expression.
     */
    Twig.token.strings = ['"', "'"];

    /**
     * Parse a compiled template.
     *
     * @param {Array} tokens The compiled tokens.
     * @param {Object} context The render context.
     *
     * @return {string} The parsed template.
     */
    Twig.parse = function (tokens, context) {
        try {
            var output = [],
                // Track logic chains
                chain = true,
                that = this;

            Twig.forEach(tokens, function parseToken(token) {
                Twig.log.debug("Twig.parse: ", "Parsing token: ", token);

                switch (token.type) {
                    case Twig.token.type.raw:
                        output.push(Twig.filters.raw(token.value));
                        break;

                    case Twig.token.type.logic:
                        var logic_token = token.token,
                            logic = Twig.logic.parse.apply(that, [logic_token, context, chain]);

                        if (logic.chain !== undefined) {
                            chain = logic.chain;
                        }
                        if (logic.context !== undefined) {
                            context = logic.context;
                        }
                        if (logic.output !== undefined) {
                            output.push(logic.output);
                        }
                        break;

                    case Twig.token.type.comment:
                        // Do nothing, comments should be ignored
                        break;

                    //Fall through whitespace to output
                    case Twig.token.type.output_whitespace_pre:
                    case Twig.token.type.output_whitespace_post:
                    case Twig.token.type.output_whitespace_both:
                    case Twig.token.type.output:
                        Twig.log.debug("Twig.parse: ", "Output token: ", token.stack);
                        // Parse the given expression in the given context
                        output.push(Twig.expression.parse.apply(that, [token.stack, context]));
                        break;
                }
            });

            return Twig.output.apply(this, [output]);

        } catch (ex) {
            if (this.options.rethrow) {
                throw ex;
            }
            else {
                Twig.log.error("Error parsing twig template " + this.id + ": ");
                if (ex.stack) {
                    Twig.log.error(ex.stack);
                } else {
                    Twig.log.error(ex.toString());
                }

                if (Twig.debug) {
                    return ex.toString();
                }
            }
        }
    };

    /**
     * Join the output token's stack and escape it if needed
     *
     * @param {Array} Output token's stack
     *
     * @return {string|String} Autoescaped output
     */
    Twig.output = function(output) {
        if (!this.options.autoescape) {
            return output.join("");
        }

        var strategy = 'html';
        if (typeof this.options.autoescape == 'string')
            strategy = this.options.autoescape;

        // [].map would be better but it's not supported by IE8-
        var escaped_output = [];
        Twig.forEach(output, function (str) {
            if (str && (str.twig_markup !== true && str.twig_markup != strategy)) {
                str = Twig.filters.escape(str, [strategy]);
            }
            escaped_output.push(str);
        });

        return Twig.Markup(escaped_output.join(""));
    }

    // Namespace for template storage and retrieval
    Twig.Templates = {
        /**
         * Registered template parsers - use Twig.Templates.registerParser to add supported parsers
         * @type {Object}
         */
        parsers: {},

        /**
         * Cached / loaded templates
         * @type {Object}
         */
        registry: {}
    };

    /**
     * Register a template parser
     *
     * @example
     * Twig.extend(function(Twig) {
     *    Twig.Templates.registerParser('custom_parser', function(params) {
     *        // this template source can be accessed in params.data
     *        var template = params.data
     *
     *        // ... custom process that modifies the template
     *
     *        // return the parsed template
     *        return template;
     *    });
     * });
     *
     * @param {String} method_name The method this parser is intended for (twig, source)
     * @param {Function} func The function to execute when parsing the template
     * @param {Object|undefined} scope Optional scope parameter to bind func to
     *
     * @throws Twig.Error
     *
     * @return {void}
     */
    Twig.Templates.registerParser = function(method_name, func, scope) {
        if (typeof func !== 'function') {
            throw new Twig.Error('Unable to add parser for ' + method_name + ': Invalid function regerence given.');
        }

        if (scope) {
            func = func.bind(scope);
        }

        this.parsers[method_name] = func;
    };

    /**
     * Remove a registered parser
     *
     * @param {String} method_name The method name for the parser you wish to remove
     *
     * @return {void}
     */
    Twig.Templates.unRegisterParser = function(method_name) {
        if (this.isRegisteredParser(method_name)) {
            delete this.parsers[method_name];
        }
    };

    /**
     * See if a parser is registered by its method name
     *
     * @param {String} method_name The name of the parser you are looking for
     *
     * @return {boolean}
     */
    Twig.Templates.isRegisteredParser = function(method_name) {
        return this.parsers.hasOwnProperty(method_name);
    };

    /**
     * Save a template object to the store.
     *
     * @param {Twig.Template} template   The twig.js template to store.
     */
    Twig.Templates.save = function(template) {
        if (template.id === undefined) {
            throw new Twig.Error("Unable to save template with no id");
        }
        Twig.Templates.registry[template.id] = template;
    };

    /**
     * Load a previously saved template from the store.
     *
     * @param {string} id   The ID of the template to load.
     *
     * @return {Twig.Template} A twig.js template stored with the provided ID.
     */
    Twig.Templates.load = function(id) {
        if (!Twig.Templates.registry.hasOwnProperty(id)) {
            return null;
        }
        return Twig.Templates.registry[id];
    };

    /**
     * Create a new twig.js template.
     *
     * Parameters: {
     *      data:   The template, either pre-compiled tokens or a string template
     *      id:     The name of this template
     *      blocks: Any pre-existing block from a child template
     * }
     *
     * @param {Object} params The template parameters.
     */
    Twig.Template = function(params) {
        var data = params.data,
            id = params.id,
            blocks = params.blocks,
            path = params.path,
            name = params.name,
            // parser options
            options = params.options;

        // # What is stored in a Twig.Template
        //
        // The Twig Template hold several chucks of data.
        //
        //     {
        //          id:     The token ID (if any)
        //          tokens: The list of tokens that makes up this template.
        //          blocks: The list of block this template contains.
        //          base:   The base template (if any)
        //            options:  {
        //                Compiler/parser options
        //
        //                strict_variables: true/false
        //                    Should missing variable/keys emit an error message. If false, they default to null.
        //            }
        //     }
        //

        this.id = id;
        this.path = path;
        this.name = name;
        this.options = options;

        this.reset(blocks);

        if (Twig._is('String', data)) {
            this.tokens = Twig.prepare.apply(this, [data]);
        } else {
            this.tokens = data;
        }

        if (id !== undefined) {
            Twig.Templates.save(this);
        }
    };

    Twig.Template.prototype.reset = function (blocks) {
        Twig.log.debug("Twig.Template.reset", "Reseting template " + this.id);

        this.blocks = {};
        this.importedBlocks = [];
        this.originalBlockTokens = {};
        this.child = {
            blocks: blocks || {}
        };
        this.extend = null;
    };

    Twig.Template.prototype.render = function (context, params) {
        params = params || {};

        this.context = context || {};

        // Clear any previous state
        this.reset();

        if (params.blocks) {
            this.blocks = params.blocks;
        }

        var output = Twig.parse.apply(this, [this.tokens, this.context]);

        // Does this template extend another
        if (this.extend) {
            var ext_template = Twig.Templates.load(this.extend);
            if (ext_template) {
                ext_template.options = this.options;
            }

            this.parent = ext_template;

            return this.parent.render(this.context, {
                blocks: this.blocks
            });
        }

        if (params.output == 'blocks') {
            return this.blocks;
        } else {
            return output;
        }
    };

    Twig.Template.prototype.importFile = function (file) {
        file = this.path ? this.path + '/' + file : file;
        var sub_template = Twig.Templates.load(file);

        if (!sub_template) {
            throw new Twig.Error("Unable to find the template " + file);
        }

        sub_template.options = this.options;

        return sub_template;
    };

    Twig.Template.prototype.importBlocks = function (file, override) {
        var sub_template = this.importFile(file),
            context = this.context,
            that = this;

        override = override || false;

        sub_template.render(context);

        // Mixin blocks
        Twig.forEach(Object.keys(sub_template.blocks), function(key) {
            if (override || that.blocks[key] === undefined) {
                that.blocks[key] = sub_template.blocks[key];
                that.importedBlocks.push(key);
            }
        });
    };

    /**
     * Create safe output
     * @param {string} Content safe to output
     * @return {String} Content wrapped into a String
     */
    Twig.Markup = function(content, strategy) {
        if (typeof strategy == 'undefined') {
            strategy = true;
        }

        if (typeof content === 'string' && content.length > 0) {
            content = new String(content);
            content.twig_markup = strategy;
        }

        return content;
    };

    return Twig;

})(Twig);


// ## twig.logic.js
//
// This file handles tokenizing, compiling and parsing logic tokens. {% ... %}
(function (Twig) {
    "use strict";

    /**
     * Namespace for logic handling.
     */
    Twig.logic = {};

    /**
     * Logic token types.
     */
    Twig.logic.type = {
        if_: 'Twig.logic.type.if',
        endif: 'Twig.logic.type.endif',
        for_: 'Twig.logic.type.for',
        endfor: 'Twig.logic.type.endfor',
        else_: 'Twig.logic.type.else',
        elseif: 'Twig.logic.type.elseif',
        set: 'Twig.logic.type.set',
        setcapture: 'Twig.logic.type.setcapture',
        endset: 'Twig.logic.type.endset',
        filter: 'Twig.logic.type.filter',
        endfilter: 'Twig.logic.type.endfilter',
        shortblock: 'Twig.logic.type.shortblock',
        block: 'Twig.logic.type.block',
        endblock: 'Twig.logic.type.endblock',
        extends_: 'Twig.logic.type.extends',
        use: 'Twig.logic.type.use',
        include: 'Twig.logic.type.include',
        spaceless: 'Twig.logic.type.spaceless',
        endspaceless: 'Twig.logic.type.endspaceless',
        embed: 'Twig.logic.type.embed',
        endembed: 'Twig.logic.type.endembed'
    };


    // Regular expressions for handling logic tokens.
    //
    // Properties:
    //
    //      type:  The type of expression this matches
    //
    //      regex: A regular expression that matches the format of the token
    //
    //      next:  What logic tokens (if any) pop this token off the logic stack. If empty, the
    //             logic token is assumed to not require an end tag and isn't push onto the stack.
    //
    //      open:  Does this tag open a logic expression or is it standalone. For example,
    //             {% endif %} cannot exist without an opening {% if ... %} tag, so open = false.
    //
    //  Functions:
    //
    //      compile: A function that handles compiling the token into an output token ready for
    //               parsing with the parse function.
    //
    //      parse:   A function that parses the compiled token into output (HTML / whatever the
    //               template represents).
    Twig.logic.definitions = [
        {
            /**
             * If type logic tokens.
             *
             *  Format: {% if expression %}
             */
            type: Twig.logic.type.if_,
            parse: function (token, context, chain) {
                var output = '',
                    // Parse the expression
                    result = Twig.expression.parse.apply(this, [token.stack, context]);

                // Start a new logic chain
                chain = true;

                if (Twig.lib.boolval(result)) {
                    chain = false;
                    // parse if output
                    output = Twig.parse.apply(this, [token.output, context]);
                }
                return {
                    chain: chain,
                    output: output
                };
            }
        },
        {
            /**
             * Else if type logic tokens.
             *
             *  Format: {% elseif expression %}
             */
            type: Twig.logic.type.elseif,
            parse: function (token, context, chain) {
                var output = '',
                    result = Twig.expression.parse.apply(this, [token.stack, context]);

                if (chain && Twig.lib.boolval(result)) {
                    chain = false;
                    // parse if output
                    output = Twig.parse.apply(this, [token.output, context]);
                }

                return {
                    chain: chain,
                    output: output
                };
            }
        },
        {
            /**
             * Else if type logic tokens.
             *
             *  Format: {% elseif expression %}
             */
            type: Twig.logic.type.else_,
            parse: function (token, context, chain) {
                var output = '';
                if (chain) {
                    output = Twig.parse.apply(this, [token.output, context]);
                }
                return {
                    chain: chain,
                    output: output
                };
            }
        },
        {
            /**
             * End if type logic tokens.
             *
             *  Format: {% endif %}
             */
            type: Twig.logic.type.endif
        },
        {
            /**
             * For type logic tokens.
             *
             *  Format: {% for expression %}
             */
            type: Twig.logic.type.for_,
            parse: function (token, context, continue_chain) {
                // Parse expression
                var result = Twig.expression.parse.apply(this, [token.expression, context]),
                    output = [],
                    len,
                    index = 0,
                    keyset,
                    that = this,
                    conditional = token.conditional,
                    buildLoop = function (index, len) {
                        var isConditional = conditional !== undefined;
                        return {
                            index: index + 1,
                            index0: index,
                            revindex: isConditional ? undefined : len - index,
                            revindex0: isConditional ? undefined : len - index - 1,
                            first: (index === 0),
                            last: isConditional ? undefined : (index === len - 1),
                            length: isConditional ? undefined : len,
                            parent: context
                        };
                    },
                    // run once for each iteration of the loop
                    loop = function (key, value) {
                        var inner_context = Twig.ChildContext(context);

                        inner_context[token.value_var] = value;

                        if (token.key_var) {
                            inner_context[token.key_var] = key;
                        }

                        // Loop object
                        inner_context.loop = buildLoop(index, len);

                        if (conditional === undefined ||
                            Twig.expression.parse.apply(that, [conditional, inner_context])) {
                            output.push(Twig.parse.apply(that, [token.output, inner_context]));
                            index += 1;
                        }

                        // Delete loop-related variables from the context
                        delete inner_context['loop'];
                        delete inner_context[token.value_var];
                        delete inner_context[token.key_var];

                        // Merge in values that exist in context but have changed
                        // in inner_context.
                        Twig.merge(context, inner_context, true);
                    };


                if (Twig._is('Array', result)) {
                    len = result.length;
                    Twig.forEach(result, function (value) {
                        var key = index;

                        loop(key, value);
                    });
                } else if (Twig._is('Object', result)) {
                    if (result._keys !== undefined) {
                        keyset = result._keys;
                    } else {
                        keyset = Object.keys(result);
                    }
                    len = keyset.length;
                    Twig.forEach(keyset, function (key) {
                        // Ignore the _keys property, it's internal to twig.js
                        if (key === "_keys") return;

                        loop(key, result[key]);
                    });
                }

                // Only allow else statements if no output was generated
                continue_chain = (output.length === 0);

                return {
                    chain: continue_chain,
                    output: Twig.output.apply(this, [output])
                };
            }
        },
        {
            /**
             * End if type logic tokens.
             *
             *  Format: {% endif %}
             */
            type: Twig.logic.type.endfor,
            open: false
        },
        {
            /**
             * Set type logic tokens.
             *
             *  Format: {% set key = expression %}
             */
            type: Twig.logic.type.set,
            parse: function (token, context, continue_chain) {
                var value = Twig.expression.parse.apply(this, [token.expression, context]),
                    key = token.key;

                if (value === context) {
                    /*  If storing the context in a variable, it needs to be a clone of the current state of context.
                     Otherwise we have a context with infinite recursion.
                     Fixes #341
                     */
                    value = Twig.lib.copy(value);
                }

                context[key] = value;

                return {
                    chain: continue_chain,
                    context: context
                };
            }
        },
        {
            /**
             * Set capture type logic tokens.
             *
             *  Format: {% set key %}
             */
            type: Twig.logic.type.setcapture,
            parse: function (token, context, continue_chain) {

                var value = Twig.parse.apply(this, [token.output, context]),
                    key = token.key;

                // set on both the global and local context
                this.context[key] = value;
                context[key] = value;

                return {
                    chain: continue_chain,
                    context: context
                };
            }
        },
        {
            /**
             * End set type block logic tokens.
             *
             *  Format: {% endset %}
             */
            type: Twig.logic.type.endset
        },
        {
            /**
             * Filter logic tokens.
             *
             *  Format: {% filter upper %} or {% filter lower|escape %}
             */
            type: Twig.logic.type.filter,
            parse: function (token, context, chain) {
                var unfiltered = Twig.parse.apply(this, [token.output, context]),
                    stack = [{
                        type: Twig.expression.type.string,
                        value: unfiltered
                    }].concat(token.stack);

                var output = Twig.expression.parse.apply(this, [stack, context]);

                return {
                    chain: chain,
                    output: output
                };
            }
        },
        {
            /**
             * End filter logic tokens.
             *
             *  Format: {% endfilter %}
             */
            type: Twig.logic.type.endfilter
        },
        {
            /**
             * Block logic tokens.
             *
             *  Format: {% block title %}
             */
            type: Twig.logic.type.block,
            parse: function (token, context, chain) {
                var block_output,
                    output,
                    isImported = this.importedBlocks.indexOf(token.block) > -1,
                    hasParent = this.blocks[token.block] && this.blocks[token.block].indexOf(Twig.placeholders.parent) > -1;

                // Don't override previous blocks unless they're imported with "use"
                // Loops should be exempted as well.
                if (this.blocks[token.block] === undefined || isImported || hasParent || context.loop || token.overwrite) {
                    if (token.expression) {
                        // Short blocks have output as an expression on the open tag (no body)
                        block_output = Twig.expression.parse.apply(this, [{
                            type: Twig.expression.type.string,
                            value: Twig.expression.parse.apply(this, [token.output, context])
                        }, context]);
                    } else {
                        block_output = Twig.expression.parse.apply(this, [{
                            type: Twig.expression.type.string,
                            value: Twig.parse.apply(this, [token.output, context])
                        }, context]);
                    }

                    if (isImported) {
                        // once the block is overridden, remove it from the list of imported blocks
                        this.importedBlocks.splice(this.importedBlocks.indexOf(token.block), 1);
                    }

                    if (hasParent) {
                        this.blocks[token.block] = Twig.Markup(this.blocks[token.block].replace(Twig.placeholders.parent, block_output));
                    } else {
                        this.blocks[token.block] = block_output;
                    }

                    this.originalBlockTokens[token.block] = {
                        type: token.type,
                        block: token.block,
                        output: token.output,
                        overwrite: true
                    };
                }

                // Check if a child block has been set from a template extending this one.
                if (this.child.blocks[token.block]) {
                    output = this.child.blocks[token.block];
                } else {
                    output = this.blocks[token.block];
                }

                return {
                    chain: chain,
                    output: output
                };
            }
        },
        {
            /**
             * Block shorthand logic tokens.
             *
             *  Format: {% block title expression %}
             */
            type: Twig.logic.type.shortblock,
            parse: function (token, context, chain) {
                return Twig.logic.handler[Twig.logic.type.block].parse.apply(this, arguments);
            }
        },
        {
            /**
             * End block logic tokens.
             *
             *  Format: {% endblock %}
             */
            type: Twig.logic.type.endblock
        },
        {
            /**
             * Block logic tokens.
             *
             *  Format: {% extends "template.twig" %}
             */
            type: Twig.logic.type.extends_,
            parse: function (token, context, chain) {
                var template,
                    innerContext = Twig.ChildContext(context);
                // Resolve filename
                var file = Twig.expression.parse.apply(this, [token.stack, context]);

                // Set parent template
                this.extend = file;

                if (file instanceof Twig.Template) {
                    template = file;
                } else {
                    // Import file
                    template = this.importFile(file);
                }

                // Render the template in case it puts anything in its context
                template.render(innerContext);

                // Extend the parent context with the extended context
                Twig.lib.extend(context, innerContext);

                return {
                    chain: chain,
                    output: ''
                };
            }
        },
        {
            /**
             * Block logic tokens.
             *
             *  Format: {% use "template.twig" %}
             */
            type: Twig.logic.type.use,
            parse: function (token, context, chain) {
                // Resolve filename
                var file = Twig.expression.parse.apply(this, [token.stack, context]);

                // Import blocks
                this.importBlocks(file);

                return {
                    chain: chain,
                    output: ''
                };
            }
        },
        {
            /**
             * Block logic tokens.
             *
             *  Format: {% includes "template.twig" [with {some: 'values'} only] %}
             */
            type: Twig.logic.type.include,
            parse: function (token, context, chain) {
                // Resolve filename
                var innerContext = {},
                    withContext,
                    i,
                    template;

                if (!token.only) {
                    innerContext = Twig.ChildContext(context);
                }

                if (token.withStack !== undefined) {
                    withContext = Twig.expression.parse.apply(this, [token.withStack, context]);

                    for (i in withContext) {
                        if (withContext.hasOwnProperty(i))
                            innerContext[i] = withContext[i];
                    }
                }

                var file = Twig.expression.parse.apply(this, [token.stack, context]);

                if (file instanceof Twig.Template) {
                    template = file;
                } else {
                    // Import file
                    try {
                        template = this.importFile(file);
                    } catch (err) {
                        if (token.ignoreMissing) {
                            return {
                                chain: chain,
                                output: ''
                            }
                        }

                        throw err;
                    }
                }

                return {
                    chain: chain,
                    output: template.render(innerContext)
                };
            }
        },
        {
            type: Twig.logic.type.spaceless,
            // Parse the html and return it without any spaces between tags
            parse: function (token, context, chain) {
                var // Parse the output without any filter
                    unfiltered = Twig.parse.apply(this, [token.output, context]),
                    // A regular expression to find closing and opening tags with spaces between them
                    rBetweenTagSpaces = />\s+</g,
                    // Replace all space between closing and opening html tags
                    output = unfiltered.replace(rBetweenTagSpaces, '><').trim();
                // Rewrap output as a Twig.Markup
                output = Twig.Markup(output);
                return {
                    chain: chain,
                    output: output
                };
            }
        },

        // Add the {% endspaceless %} token
        {
            type: Twig.logic.type.endspaceless
        },
        {
            /**
             * The embed tag combines the behaviour of include and extends.
             * It allows you to include another template's contents, just like include does.
             *
             *  Format: {% embed "template.twig" [with {some: 'values'} only] %}
             */
            type: Twig.logic.type.embed,
            parse: function (token, context, chain) {
                // Resolve filename
                var innerContext = {},
                    withContext,
                    i,
                    template;

                if (!token.only) {
                    for (i in context) {
                        if (context.hasOwnProperty(i))
                            innerContext[i] = context[i];
                    }
                }

                if (token.withStack !== undefined) {
                    withContext = Twig.expression.parse.apply(this, [token.withStack, context]);

                    for (i in withContext) {
                        if (withContext.hasOwnProperty(i))
                            innerContext[i] = withContext[i];
                    }
                }

                var file = Twig.expression.parse.apply(this, [token.stack, innerContext]);

                if (file instanceof Twig.Template) {
                    template = file;
                } else {
                    // Import file
                    try {
                        template = this.importFile(file);
                    } catch (err) {
                        if (token.ignoreMissing) {
                            return {
                                chain: chain,
                                output: ''
                            }
                        }

                        throw err;
                    }
                }

                // reset previous blocks
                this.blocks = {};

                // parse tokens. output will be not used
                var output = Twig.parse.apply(this, [token.output, innerContext]);

                // render tempalte with blocks defined in embed block
                return {
                    chain: chain,
                    output: template.render(innerContext, {'blocks': this.blocks})
                };
            }
        },
        /* Add the {% endembed %} token
         *
         */
        {
            type: Twig.logic.type.endembed
        }

    ];


    /**
     * Registry for logic handlers.
     */
    Twig.logic.handler = {};

    /**
     * Define a new token type, available at Twig.logic.type.{type}
     */
    Twig.logic.extendType = function (type, value) {
        value = value || ("Twig.logic.type" + type);
        Twig.logic.type[type] = value;
    };

    /**
     * Extend the logic parsing functionality with a new token definition.
     *
     * // Define a new tag
     * Twig.logic.extend({
     *     type: Twig.logic.type.{type},
     *     // The pattern to match for this token
     *     regex: ...,
     *     // What token types can follow this token, leave blank if any.
     *     next: [ ... ]
     *     // Create and return compiled version of the token
     *     compile: function(token) { ... }
     *     // Parse the compiled token with the context provided by the render call
     *     //   and whether this token chain is complete.
     *     parse: function(token, context, chain) { ... }
     * });
     *
     * @param {Object} definition The new logic expression.
     */
    Twig.logic.extend = function (definition) {
        if (!definition.type) {
            throw new Twig.Error("Unable to extend logic definition. No type provided for " + definition);
        } else {
            Twig.logic.extendType(definition.type);
        }
        Twig.logic.handler[definition.type] = definition;
    };

    // Extend with built-in expressions
    while (Twig.logic.definitions.length > 0) {
        Twig.logic.extend(Twig.logic.definitions.shift());
    }

    /**
     * Parse a logic token within a given context.
     *
     * What are logic chains?
     *      Logic chains represent a series of tokens that are connected,
     *          for example:
     *          {% if ... %} {% else %} {% endif %}
     *
     *      The chain parameter is used to signify if a chain is open of closed.
     *      open:
     *          More tokens in this chain should be parsed.
     *      closed:
     *          This token chain has completed parsing and any additional
     *          tokens (else, elseif, etc...) should be ignored.
     *
     * @param {Object} token The compiled token.
     * @param {Object} context The render context.
     * @param {boolean} chain Is this an open logic chain. If false, that means a
     *                        chain is closed and no further cases should be parsed.
     */
    Twig.logic.parse = function (token, context, chain) {
        var output = '',
            token_template;

        context = context || {};

        Twig.log.debug("Twig.logic.parse: ", "Parsing logic token ", token);

        token_template = Twig.logic.handler[token.type];

        if (token_template.parse) {
            output = token_template.parse.apply(this, [token, context, chain]);
        }
        return output;
    };

    return Twig;

})(Twig);


// ## twig.expression.js
//
// This file handles tokenizing, compiling and parsing expressions.
(function (Twig) {
    "use strict";

    /**
     * Namespace for expression handling.
     */
    Twig.expression = {};

    // ## twig.expression.operator.js
    //
    // This file handles operator lookups and parsing.
    (function (Twig) {
        "use strict";

        /**
         * Operator associativity constants.
         */
        Twig.expression.operator = {
            leftToRight: 'leftToRight',
            rightToLeft: 'rightToLeft'
        };

        var containment = function (a, b) {
            if (b === undefined || b === null) {
                return null;
            } else if (b.indexOf !== undefined) {
                // String
                return a === b || a !== '' && b.indexOf(a) > -1;
            } else {
                var el;
                for (el in b) {
                    if (b.hasOwnProperty(el) && b[el] === a) {
                        return true;
                    }
                }
                return false;
            }
        };

        /**
         * Handle operations on the RPN stack.
         *
         * Returns the updated stack.
         */
        Twig.expression.operator.parse = function (operator, stack) {
            Twig.log.trace("Twig.expression.operator.parse: ", "Handling ", operator);
            var a, b, c;

            if (operator === '?') {
                c = stack.pop();
            }

            b = stack.pop();
            if (operator !== 'not') {
                a = stack.pop();
            }

            if (operator !== 'in' && operator !== 'not in') {
                if (a && Array.isArray(a)) {
                    a = a.length;
                }

                if (b && Array.isArray(b)) {
                    b = b.length;
                }
            }

            switch (operator) {
                case ':':
                    // Ignore
                    break;

                case '?:':
                    if (Twig.lib.boolval(a)) {
                        stack.push(a);
                    } else {
                        stack.push(b);
                    }
                    break;
                case '?':
                    if (a === undefined) {
                        //An extended ternary.
                        a = b;
                        b = c;
                        c = undefined;
                    }

                    if (Twig.lib.boolval(a)) {
                        stack.push(b);
                    } else {
                        stack.push(c);
                    }
                    break;

                case '+':
                    b = parseFloat(b);
                    a = parseFloat(a);
                    stack.push(a + b);
                    break;

                case '-':
                    b = parseFloat(b);
                    a = parseFloat(a);
                    stack.push(a - b);
                    break;

                case '*':
                    b = parseFloat(b);
                    a = parseFloat(a);
                    stack.push(a * b);
                    break;

                case '/':
                    b = parseFloat(b);
                    a = parseFloat(a);
                    stack.push(a / b);
                    break;

                case '//':
                    b = parseFloat(b);
                    a = parseFloat(a);
                    stack.push(Math.floor(a / b));
                    break;

                case '%':
                    b = parseFloat(b);
                    a = parseFloat(a);
                    stack.push(a % b);
                    break;

                case '~':
                    stack.push((a != null ? a.toString() : "")
                        + (b != null ? b.toString() : ""));
                    break;

                case 'not':
                case '!':
                    stack.push(!Twig.lib.boolval(b));
                    break;

                case '<':
                    stack.push(a < b);
                    break;

                case '<=':
                    stack.push(a <= b);
                    break;

                case '>':
                    stack.push(a > b);
                    break;

                case '>=':
                    stack.push(a >= b);
                    break;

                case '===':
                    stack.push(a === b);
                    break;

                case '==':
                    stack.push(a == b);
                    break;

                case '!==':
                    stack.push(a !== b);
                    break;

                case '!=':
                    stack.push(a != b);
                    break;

                case 'or':
                    stack.push(a || b);
                    break;

                case 'and':
                    stack.push(a && b);
                    break;

                case '**':
                    stack.push(Math.pow(a, b));
                    break;

                case 'not in':
                    stack.push(!containment(a, b));
                    break;

                case 'in':
                    stack.push(containment(a, b));
                    break;

                case '..':
                    stack.push(Twig.functions.range(a, b));
                    break;

                default:
                    debugger;
                    throw new Twig.Error("Failed to parse operator: " + operator + " is an unknown operator.");
            }
        };

        return Twig;

    })(Twig);

    /**
     * Reserved word that can't be used as variable names.
     */
    Twig.expression.reservedWords = [
        "true", "false", "null", "TRUE", "FALSE", "NULL", "_context", "and", "or", "in", "not in", "if"
    ];

    /**
     * The type of tokens used in expressions.
     */
    Twig.expression.type = {
        comma: 'Twig.expression.type.comma',
        operator: {
            unary: 'Twig.expression.type.operator.unary',
            binary: 'Twig.expression.type.operator.binary'
        },
        string: 'Twig.expression.type.string',
        bool: 'Twig.expression.type.bool',
        slice: 'Twig.expression.type.slice',
        array: {
            start: 'Twig.expression.type.array.start',
            end: 'Twig.expression.type.array.end'
        },
        object: {
            start: 'Twig.expression.type.object.start',
            end: 'Twig.expression.type.object.end'
        },
        parameter: {
            start: 'Twig.expression.type.parameter.start',
            end: 'Twig.expression.type.parameter.end'
        },
        subexpression: {
            start: 'Twig.expression.type.subexpression.start',
            end: 'Twig.expression.type.subexpression.end'
        },
        key: {
            period: 'Twig.expression.type.key.period',
            brackets: 'Twig.expression.type.key.brackets'
        },
        filter: 'Twig.expression.type.filter',
        _function: 'Twig.expression.type._function',
        variable: 'Twig.expression.type.variable',
        number: 'Twig.expression.type.number',
        _null: 'Twig.expression.type.null',
        context: 'Twig.expression.type.context',
        test: 'Twig.expression.type.test'
    };

    Twig.expression.set = {
        // What can follow an expression (in general)
        operations: [
            Twig.expression.type.filter,
            Twig.expression.type.operator.unary,
            Twig.expression.type.operator.binary,
            Twig.expression.type.array.end,
            Twig.expression.type.object.end,
            Twig.expression.type.parameter.end,
            Twig.expression.type.subexpression.end,
            Twig.expression.type.comma,
            Twig.expression.type.test
        ],
        expressions: [
            Twig.expression.type._function,
            Twig.expression.type.bool,
            Twig.expression.type.string,
            Twig.expression.type.variable,
            Twig.expression.type.number,
            Twig.expression.type._null,
            Twig.expression.type.context,
            Twig.expression.type.parameter.start,
            Twig.expression.type.array.start,
            Twig.expression.type.object.start,
            Twig.expression.type.subexpression.start
        ]
    };

    // Most expressions allow a '.' or '[' after them, so we provide a convenience set
    Twig.expression.set.operations_extended = Twig.expression.set.operations.concat([
        Twig.expression.type.key.period,
        Twig.expression.type.key.brackets,
        Twig.expression.type.slice]);

    // Some commonly used compile and parse functions.
    Twig.expression.fn = {
        parse: {
            push: function (token, stack, context) {
                stack.push(token);
            },
            push_value: function (token, stack, context) {
                stack.push(token.value);
            }
        }
    };

    // The regular expressions and compile/parse logic used to match tokens in expressions.
    //
    // Properties:
    //
    //      type:  The type of expression this matches
    //
    //      regex: One or more regular expressions that matche the format of the token.
    //
    //      next:  Valid tokens that can occur next in the expression.
    //
    // Functions:
    //
    //      compile: A function that compiles the raw regular expression match into a token.
    //
    //      parse:   A function that parses the compiled token into output.
    //
    Twig.expression.definitions = [
        {
            type: Twig.expression.type.test,
            parse: function (token, stack, context) {
                var value = stack.pop(),
                    params = token.params && Twig.expression.parse.apply(this, [token.params, context]),
                    result = Twig.test(token.filter, value, params);

                if (token.modifier == 'not') {
                    stack.push(!result);
                } else {
                    stack.push(result);
                }
            }
        },
        {
            type: Twig.expression.type.comma
        },
        {
            /**
             * Match a number (integer or decimal)
             */
            type: Twig.expression.type.number,
            parse: Twig.expression.fn.parse.push_value
        },
        {
            type: Twig.expression.type.operator.binary,
            parse: function (token, stack, context) {
                if (token.key) {
                    // handle ternary ':' operator
                    stack.push(token);
                } else if (token.params) {
                    // handle "{(expression):value}"
                    token.key = Twig.expression.parse.apply(this, [token.params, context]);
                    stack.push(token);

                    //If we're in a loop, we might need token.params later, especially in this form of "(expression):value"
                    if (!context.loop) {
                        delete(token.params);
                    }
                } else {
                    Twig.expression.operator.parse(token.value, stack);
                }
            }
        },
        {
            type: Twig.expression.type.operator.unary,
            parse: function (token, stack, context) {
                Twig.expression.operator.parse(token.value, stack);
            }
        },
        {
            /**
             * Match a string. This is anything between a pair of single or double quotes.
             */
            type: Twig.expression.type.string,
            parse: Twig.expression.fn.parse.push_value
        },
        {
            /**
             * Match a subexpression set start.
             */
            type: Twig.expression.type.subexpression.start,
            parse: Twig.expression.fn.parse.push
        },
        {
            /**
             * Match a subexpression set end.
             */
            type: Twig.expression.type.subexpression.end,
            parse: function (token, stack, context) {
                var new_array = [],
                    array_ended = false,
                    value = null;

                if (token.expression) {
                    value = Twig.expression.parse.apply(this, [token.params, context]);
                    stack.push(value);
                } else {
                    throw new Twig.Error("Unexpected subexpression end when token is not marked as an expression");
                }
            }
        },
        {
            /**
             * Match a parameter set start.
             */
            type: Twig.expression.type.parameter.start,
            parse: Twig.expression.fn.parse.push
        },
        {
            /**
             * Match a parameter set end.
             */
            type: Twig.expression.type.parameter.end,
            parse: function (token, stack, context) {
                var new_array = [],
                    array_ended = false,
                    value = null;

                if (token.expression) {
                    value = Twig.expression.parse.apply(this, [token.params, context])
                    stack.push(value);

                } else {

                    while (stack.length > 0) {
                        value = stack.pop();
                        // Push values into the array until the start of the array
                        if (value && value.type && value.type == Twig.expression.type.parameter.start) {
                            array_ended = true;
                            break;
                        }
                        new_array.unshift(value);
                    }

                    if (!array_ended) {
                        throw new Twig.Error("Expected end of parameter set.");
                    }

                    stack.push(new_array);
                }
            }
        },
        {
            type: Twig.expression.type.slice,
            parse: function (token, stack, context) {
                var input = stack.pop(),
                    params = token.params;

                stack.push(Twig.filter.apply(this, [token.value, input, params]));
            }
        },
        {
            /**
             * Match an array start.
             */
            type: Twig.expression.type.array.start,
            parse: Twig.expression.fn.parse.push
        },
        {
            /**
             * Match an array end.
             */
            type: Twig.expression.type.array.end,
            parse: function (token, stack, context) {
                var new_array = [],
                    array_ended = false,
                    value = null;

                while (stack.length > 0) {
                    value = stack.pop();
                    // Push values into the array until the start of the array
                    if (value.type && value.type == Twig.expression.type.array.start) {
                        array_ended = true;
                        break;
                    }
                    new_array.unshift(value);
                }
                if (!array_ended) {
                    throw new Twig.Error("Expected end of array.");
                }

                stack.push(new_array);
            }
        },
        // Token that represents the start of a hash map '}'
        //
        // Hash maps take the form:
        //    { "key": 'value', "another_key": item }
        //
        // Keys must be quoted (either single or double) and values can be any expression.
        {
            type: Twig.expression.type.object.start,
            parse: Twig.expression.fn.parse.push
        },

        // Token that represents the end of a Hash Map '}'
        //
        // This is where the logic for building the internal
        // representation of a hash map is defined.
        {
            type: Twig.expression.type.object.end,
            parse: function (end_token, stack, context) {
                var new_object = {},
                    object_ended = false,
                    token = null,
                    token_key = null,
                    has_value = false,
                    value = null;

                while (stack.length > 0) {
                    token = stack.pop();
                    // Push values into the array until the start of the object
                    if (token && token.type && token.type === Twig.expression.type.object.start) {
                        object_ended = true;
                        break;
                    }
                    if (token && token.type && (token.type === Twig.expression.type.operator.binary || token.type === Twig.expression.type.operator.unary) && token.key) {
                        if (!has_value) {
                            throw new Twig.Error("Missing value for key '" + token.key + "' in object definition.");
                        }
                        new_object[token.key] = value;

                        // Preserve the order that elements are added to the map
                        // This is necessary since JavaScript objects don't
                        // guarantee the order of keys
                        if (new_object._keys === undefined) new_object._keys = [];
                        new_object._keys.unshift(token.key);

                        // reset value check
                        value = null;
                        has_value = false;

                    } else {
                        has_value = true;
                        value = token;
                    }
                }
                if (!object_ended) {
                    throw new Twig.Error("Unexpected end of object.");
                }

                stack.push(new_object);
            }
        },

        // Token representing a filter
        //
        // Filters can follow any expression and take the form:
        //    expression|filter(optional, args)
        //
        // Filter parsing is done in the Twig.filters namespace.
        {
            type: Twig.expression.type.filter,
            parse: function (token, stack, context) {
                var input = stack.pop(),
                    params = token.params && Twig.expression.parse.apply(this, [token.params, context]);

                stack.push(Twig.filter.apply(this, [token.value, input, params]));
            }
        },
        {
            type: Twig.expression.type._function,
            parse: function (token, stack, context) {
                var params = token.params && Twig.expression.parse.apply(this, [token.params, context]),
                    fn = token.fn,
                    value;

                if (Twig.functions[fn]) {
                    // Get the function from the built-in functions
                    value = Twig.functions[fn].apply(this, params);

                } else if (typeof context[fn] == 'function') {
                    // Get the function from the user/context defined functions
                    value = context[fn].apply(context, params);

                } else {
                    throw new Twig.Error(fn + ' function does not exist and is not defined in the context');
                }

                stack.push(value);
            }
        },

        // Token representing a variable.
        //
        // Variables can contain letters, numbers, underscores and
        // dashes, but must start with a letter or underscore.
        //
        // Variables are retrieved from the render context and take
        // the value of 'undefined' if the given variable doesn't
        // exist in the context.
        {
            type: Twig.expression.type.variable,
            parse: function (token, stack, context) {
                // Get the variable from the context
                var value = Twig.expression.resolve.apply(this, [context[token.value], context]);
                stack.push(value);
            }
        },
        {
            type: Twig.expression.type.key.period,
            parse: function (token, stack, context, next_token) {
                var params = token.params && Twig.expression.parse.apply(this, [token.params, context]),
                    key = token.key,
                    object = stack.pop(),
                    value;

                if (object === null || object === undefined) {
                    if (this.options.strict_variables) {
                        throw new Twig.Error("Can't access a key " + key + " on an null or undefined object.");
                    } else {
                        value = undefined;
                    }
                } else {
                    var capitalize = function (value) {
                        return value.substr(0, 1).toUpperCase() + value.substr(1);
                    };

                    // Get the variable from the context
                    if (typeof object === 'object' && key in object) {
                        value = object[key];
                    } else if (object["get" + capitalize(key)] !== undefined) {
                        value = object["get" + capitalize(key)];
                    } else if (object["is" + capitalize(key)] !== undefined) {
                        value = object["is" + capitalize(key)];
                    } else {
                        value = undefined;
                    }
                }

                // When resolving an expression we need to pass next_token in case the expression is a function
                stack.push(Twig.expression.resolve.apply(this, [value, context, params, next_token]));
            }
        },
        {
            type: Twig.expression.type.key.brackets,
            parse: function (token, stack, context, next_token) {
                // Evaluate key
                var params = token.params && Twig.expression.parse.apply(this, [token.params, context]),
                    key = Twig.expression.parse.apply(this, [token.stack, context]),
                    object = stack.pop(),
                    value;

                if (object === null || object === undefined) {
                    if (this.options.strict_variables) {
                        throw new Twig.Error("Can't access a key " + key + " on an null or undefined object.");
                    } else {
                        return null;
                    }
                }

                // Get the variable from the context
                if (typeof object === 'object' && key in object) {
                    value = object[key];
                } else {
                    value = null;
                }

                // When resolving an expression we need to pass next_token in case the expression is a function
                stack.push(Twig.expression.resolve.apply(this, [value, object, params, next_token]));
            }
        },
        {
            /**
             * Match a null value.
             */
            type: Twig.expression.type._null,
            parse: Twig.expression.fn.parse.push_value
        },
        {
            /**
             * Match the context
             */
            type: Twig.expression.type.context,
            parse: function (token, stack, context) {
                stack.push(context);
            }
        },
        {
            /**
             * Match a boolean
             */
            type: Twig.expression.type.bool,
            parse: Twig.expression.fn.parse.push_value
        }
    ];

    /**
     * Resolve a context value.
     *
     * If the value is a function, it is executed with a context parameter.
     *
     * @param {string} key The context object key.
     * @param {Object} context The render context.
     */
    Twig.expression.resolve = function (value, context, params, next_token) {
        if (typeof value == 'function') {
            /*
             If value is a function, it will have been impossible during the compile stage to determine that a following
             set of parentheses were parameters for this function.

             Those parentheses will have therefore been marked as an expression, with their own parameters, which really
             belong to this function.

             Those parameters will also need parsing in case they are actually an expression to pass as parameters.
             */
            if (next_token && next_token.type === Twig.expression.type.parameter.end) {
                //When parsing these parameters, we need to get them all back, not just the last item on the stack.
                var tokens_are_parameters = true;

                params = next_token.params && Twig.expression.parse.apply(this, [next_token.params, context, tokens_are_parameters]);

                //Clean up the parentheses tokens on the next loop
                next_token.cleanup = true;
            }
            return value.apply(context, params || []);
        } else {
            return value;
        }
    };

    /**
     * Registry for logic handlers.
     */
    Twig.expression.handler = {};

    /**
     * Define a new expression type, available at Twig.logic.type.{type}
     *
     * @param {string} type The name of the new type.
     */
    Twig.expression.extendType = function (type) {
        Twig.expression.type[type] = "Twig.expression.type." + type;
    };

    /**
     * Extend the expression parsing functionality with a new definition.
     *
     * Token definitions follow this format:
     *  {
     *      type:     One of Twig.expression.type.[type], either pre-defined or added using
     *                    Twig.expression.extendType
     *
     *      next:     Array of types from Twig.expression.type that can follow this token,
     *
     *      regex:    A regex or array of regex's that should match the token.
     *
     *      compile: function(token, stack, output) called when this token is being compiled.
     *                   Should return an object with stack and output set.
     *
     *      parse:   function(token, stack, context) called when this token is being parsed.
     *                   Should return an object with stack and context set.
     *  }
     *
     * @param {Object} definition A token definition.
     */
    Twig.expression.extend = function (definition) {
        if (!definition.type) {
            throw new Twig.Error("Unable to extend logic definition. No type provided for " + definition);
        }
        Twig.expression.handler[definition.type] = definition;
    };

    // Extend with built-in expressions
    while (Twig.expression.definitions.length > 0) {
        Twig.expression.extend(Twig.expression.definitions.shift());
    }

    /**
     * Parse an RPN expression stack within a context.
     *
     * @param {Array} tokens An array of compiled expression tokens.
     * @param {Object} context The render context to parse the tokens with.
     *
     * @return {Object} The result of parsing all the tokens. The result
     *                  can be anything, String, Array, Object, etc... based on
     *                  the given expression.
     */
    Twig.expression.parse = function (tokens, context, tokens_are_parameters) {
        var that = this;

        // If the token isn't an array, make it one.
        if (!(tokens instanceof Array)) {
            tokens = [tokens];
        }

        // The output stack
        var stack = [],
            next_token,
            token_template = null,
            loop_token_fixups = [];

        Twig.forEach(tokens, function (token, index) {
            //If the token is marked for cleanup, we don't need to parse it
            if (token.cleanup) {
                return;
            }

            //Determine the token that follows this one so that we can pass it to the parser
            if (tokens.length > index + 1) {
                next_token = tokens[index + 1];
            }

            token_template = Twig.expression.handler[token.type];

            token_template.parse && token_template.parse.apply(that, [token, stack, context, next_token]);

            //Store any binary tokens for later if we are in a loop.
            if (context.loop && token.type === Twig.expression.type.operator.binary) {
                loop_token_fixups.push(token);
            }
        });

        //Check every fixup and remove "key" as long as they still have "params". This covers the use case where
        //a ":" operator is used in a loop with a "(expression):" statement. We need to be able to evaluate the expression
        Twig.forEach(loop_token_fixups, function (loop_token_fixup) {
            if (loop_token_fixup.params && loop_token_fixup.key) {
                delete loop_token_fixup["key"];
            }
        });

        //If parse has been called with a set of tokens that are parameters, we need to return the whole stack,
        //wrapped in an Array.
        if (tokens_are_parameters) {
            var params = [];
            while (stack.length > 0) {
                params.unshift(stack.pop());
            }

            stack.push(params);
        }

        // Pop the final value off the stack
        return stack.pop();
    };

    return Twig;

})(Twig);


// ## twig.filters.js
//
// This file handles parsing filters.
(function (Twig) {

    Twig.filters = {
        upper: function(value) {
            if (typeof value !== "string") return value;
            return value.toUpperCase();
        },
        lower: function(value) {
            if (typeof value !== "string")  return value;
            return value.toLowerCase();
        },
        length: function(value) {
            if (Twig._is("Array", value) || typeof value === "string") {
                return value.length;
            } else if (Twig._is("Object", value)) {
                if (value._keys === undefined) {
                    return Object.keys(value).length;
                } else {
                    return value._keys.length;
                }
            } else {
                return 0;
            }
        },
        reverse: function(value) {
            if (Twig._is("Array", value)) {
                return value.reverse();
            } else if (Twig._is("String", value)) {
                return value.split("").reverse().join("");
            } else if (Twig._is("Object", value)) {
                var keys = value._keys || Object.keys(value).reverse();
                value._keys = keys;
                return value;
            }
        },
        keys: function(value) {
            if (value === undefined || value === null) return;

            var keyset = value._keys || Object.keys(value)
            var output = [];

            Twig.forEach(keyset, function(key) {
                if (key === "_keys") return; // Ignore the _keys property
                if (value.hasOwnProperty(key)) {
                    output.push(key);
                }
            });

            return output;
        },
        url_encode: function(value) {
            if (value === undefined || value === null) return;

            var result = encodeURIComponent(value);
            result = result.replace("'", "%27");

            return result;
        },
        join: function(value, params) { // !!!!!!!!!!!!!!!!!! remove afret relise 8
            if (value === undefined || value === null) return;

            var join_str = "",
                output = [],
                keyset = null;

            if (params && params[0]) {
                join_str = params[0];
            }

            if (Twig._is("Array", value)) {
                output = value;
            } else {
                keyset = value._keys || Object.keys(value);
                Twig.forEach(keyset, function(key) {
                    if (key === "_keys") return; // Ignore the _keys property
                    if (value.hasOwnProperty(key)) {
                        output.push(value[key]);
                    }
                });
            }

            return output.join(join_str);
        },
        "default": function(value, params) {
            if (params !== undefined && params.length > 1) {
                throw new Twig.Error("default filter expects one argument");
            }

            if (value === undefined || value === null || value === '') {
                if (params === undefined) return '';
                return params[0];
            } else {
                return value;
            }
        },
        date: function(value, params) {
            var date = Twig.functions.date(value);
            var format = params && params.length ? params[0] : 'F j, Y H:i';
            return Twig.lib.date(format, date);
        },
        date_modify: function(value, params) {
            if (value === undefined || value === null) return;

            if (params === undefined || params.length !== 1) {
                throw new Twig.Error("date_modify filter expects 1 argument");
            }

            var modifyText = params[0], time;

            if (Twig._is("Date", value)) {
                time = Twig.lib.strtotime(modifyText, value.getTime() / 1000);
            }
            if (Twig._is("String", value)) {
                time = Twig.lib.strtotime(modifyText, Twig.lib.strtotime(value));
            }
            if (Twig._is("Number", value)) {
                time = Twig.lib.strtotime(modifyText, value);
            }

            return new Date(time * 1000);
        },
        replace: function(value, params) {
            if (value === undefined || value === null) return;

            var pairs = params[0];
            var tag;

            for (tag in pairs) {
                if (pairs.hasOwnProperty(tag) && tag !== "_keys") {
                    value = Twig.lib.replaceAll(value, tag, pairs[tag]);
                }
            }

            return value;
        },
        striptags: function(value) {
            if (value === undefined || value === null) return;
            return Twig.lib.strip_tags(value);
        },
        escape: function(value, params) {
            if (value === undefined || value === null) return;

            var strategy = "html";
            if (params && params.length && params[0] !== true) strategy = params[0];

            if (strategy == "html") {
                var raw_value = value.toString().replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
                return Twig.Markup(raw_value, 'html');
            } else if (strategy == "url") {
                var result = Twig.filters.url_encode(value);
                return Twig.Markup(result, 'url');
            } else if (strategy == "html_attr") {
                var raw_value = value.toString();
                var result = "";

                for (var i = 0; i < raw_value.length; i++) {
                    if (raw_value[i].match(/^[a-zA-Z0-9,\.\-_]$/))
                        result += raw_value[i];
                    else if (raw_value[i].match(/^[&<>"]$/))
                        result += raw_value[i].replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/"/g, "&quot;");
                }
                return Twig.Markup(result, 'html_attr');
            } else {
                throw new Twig.Error("escape strategy unsupported");
            }
        },
        "e": function (value, params) {
            return Twig.filters.escape(value, params);
        },
        number_format: function(value, params) { // !!!!!!!!!!!  remove afret relise 8
            var number = value,
                decimals = (params && params[0]) ? params[0] : undefined,
                dec = (params && params[1] !== undefined) ? params[1] : ".",
                sep = (params && params[2] !== undefined) ? params[2] : ",";

            number = (number + '').replace(/[^0-9+\-Ee.]/g, '');
            var n = !isFinite(+number) ? 0 : +number,
                prec = !isFinite(+decimals) ? 0 : Math.abs(decimals),
                s = '',
                toFixedFix = function (n, prec) {
                    var k = Math.pow(10, prec);
                    return '' + Math.round(n * k) / k;
                };
            // Fix for IE parseFloat(0.55).toFixed(0) = 0;
            s = (prec ? toFixedFix(n, prec) : '' + Math.round(n)).split('.');
            if (s[0].length > 3) {
                s[0] = s[0].replace(/\B(?=(?:\d{3})+(?!\d))/g, sep);
            }
            if ((s[1] || '').length < prec) {
                s[1] = s[1] || '';
                s[1] += new Array(prec - s[1].length + 1).join('0');
            }

            return s.join(dec);
        },
        trim: function (value, params) {
            if (value === undefined || value === null) return;

            var str = Twig.filters.escape('' + value), whitespace;

            if (params && params[0]) {
                whitespace = '' + params[0];
            } else {
                whitespace = ' \n\r\t\f\x0b\xa0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u3000';
            }

            for (var i = 0; i < str.length; i++) {
                if (whitespace.indexOf(str.charAt(i)) === -1) {
                    str = str.substring(i);
                    break;
                }
            }

            for (i = str.length - 1; i >= 0; i--) {
                if (whitespace.indexOf(str.charAt(i)) === -1) {
                    str = str.substring(0, i + 1);
                    break;
                }
            }

            return whitespace.indexOf(str.charAt(0)) === -1 ? str : '';
        },
        slice: function (value, params) {
            if (value === undefined || value === null) return;
            if (params === undefined || params.length < 1) {
                throw new Twig.Error("slice filter expects at least 1 argument");
            }

            // default to start of string
            var start = params[0] || 0;
            // default to length of string
            var length = params.length > 1 ? params[1] : value.length;
            // handle negative start values
            var startIndex = start >= 0 ? start : Math.max(value.length + start, 0);

            if (Twig._is("Array", value)) {
                var output = [];
                for (var i = startIndex; i < startIndex + length && i < value.length; i++) {
                    output.push(value[i]);
                }
                return output;
            } else if (Twig._is("String", value)) {
                return value.substr(startIndex, length);
            } else {
                throw new Twig.Error("slice filter expects value to be an array or string");
            }
        },
        abs: function (value) {
            if (value === undefined || value === null) return;
            return Math.abs(value);
        },
        first: function (value) {
            if (Twig._is("Array", value)) {
                return value[0];
            } else if (Twig._is("Object", value)) {
                var keys = value._keys || Object.keys(value);
                return value[keys[0]];
            } else if (typeof value === "string") {
                return value.substr(0, 1);
            }

            return;
        },
        last: function (value) {
            if (Twig._is('Object', value)) {
                var keys = value._keys || Object.keys(value);
                return value[keys[keys.length - 1]];
            }

            // string|array
            return value[value.length - 1];
        },
        raw: function (value) {
            return Twig.Markup(value);
        },
        round: function (value, params) {
            params = params || [];

            var precision = params.length > 0 ? params[0] : 0,
                method = params.length > 1 ? params[1] : "common";

            value = parseFloat(value);

            if (precision && !Twig._is("Number", precision)) {
                throw new Twig.Error("round filter expects precision to be a number");
            }
            if (method === "common") {
                return Twig.lib.round(value, precision);
            }
            if (!Twig._is("Function", Math[method])) {
                throw new Twig.Error("round filter expects method to be 'floor', 'ceil', or 'common'");
            }

            return Math[method](value * Math.pow(10, precision)) / Math.pow(10, precision);
        }
    };

    Twig.filter = function (filter, value, params) {
        if (!Twig.filters[filter]) {
            throw "Unable to find filter " + filter;
        }
        return Twig.filters[filter].apply(this, [value, params]);
    };

    Twig.filter.extend = function (filter, definition) {
        Twig.filters[filter] = definition;
    };

    return Twig;

})(Twig);


// ## twig.functions.js
//
// This file handles parsing filters.
(function (Twig) {

    Twig.functions = {
        range: function (low, high, step) {
            // http://kevin.vanzonneveld.net
            // +   original by: Waldo Malqui Silva
            // *     example 1: range ( 0, 12 );
            // *     returns 1: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
            // *     example 2: range( 0, 100, 10 );
            // *     returns 2: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
            // *     example 3: range( 'a', 'i' );
            // *     returns 3: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
            // *     example 4: range( 'c', 'a' );
            // *     returns 4: ['c', 'b', 'a']
            var matrix = [];
            var inival, endval, plus;
            var walker = step || 1;
            var chars = false;

            if (!isNaN(low) && !isNaN(high)) {
                inival = parseInt(low, 10);
                endval = parseInt(high, 10);
            } else if (isNaN(low) && isNaN(high)) {
                chars = true;
                inival = low.charCodeAt(0);
                endval = high.charCodeAt(0);
            } else {
                inival = (isNaN(low) ? 0 : low);
                endval = (isNaN(high) ? 0 : high);
            }

            plus = ((inival > endval) ? false : true);
            if (plus) {
                while (inival <= endval) {
                    matrix.push(((chars) ? String.fromCharCode(inival) : inival));
                    inival += walker;
                }
            } else {
                while (inival >= endval) {
                    matrix.push(((chars) ? String.fromCharCode(inival) : inival));
                    inival -= walker;
                }
            }

            return matrix;
        },
        date: function (date) {
            var dateObj;
            var lib = Twig.lib;
            var is = Twig._is;

            if (date === undefined || date === null || date === "") {
                dateObj = new Date();
            } else if (is("Date", date)) {
                dateObj = date;
            } else if (is("String", date)) {
                if (date.match(/^[0-9]+$/)) {
                    dateObj = new Date(date * 1000);
                }
                else {
                    dateObj = new Date(lib.strtotime(date) * 1000);
                }
            } else if (is("Number", date)) {
                // timestamp
                dateObj = new Date(date * 1000);
            } else {
                throw new Twig.Error("Unable to parse date " + date);
            }

            return dateObj;
        },
        random: function (value) {
            var LIMIT_INT31 = 0x80000000;

            function getRandomNumber(n) {
                var random = Math.floor(Math.random() * LIMIT_INT31);
                var limits = [0, n];
                var min = Math.min.apply(null, limits), max = Math.max.apply(null, limits);

                return min + Math.floor((max - min + 1) * random / LIMIT_INT31);
            }

            if (Twig._is("Number", value)) {
                return getRandomNumber(value);
            }

            if (Twig._is("String", value)) {
                return value.charAt(getRandomNumber(value.length - 1));
            }

            if (Twig._is("Array", value)) {
                return value[getRandomNumber(value.length - 1)];
            }

            if (Twig._is("Object", value)) {
                var keys = Object.keys(value);
                return value[keys[getRandomNumber(keys.length - 1)]];
            }

            return getRandomNumber(LIMIT_INT31 - 1);
        }
    };

    Twig._function = function (_function, value, params) {
        if (!Twig.functions[_function]) {
            throw "Unable to find function " + _function;
        }
        return Twig.functions[_function](value, params);
    };

    Twig._function.extend = function (_function, definition) {
        Twig.functions[_function] = definition;
    };

    return Twig;

})(Twig);


// ## twig.lib.js
//
// This file contains 3rd party libraries used within twig.
//
// Copies of the licenses for the code included here can be found in the
// LICENSES.md file.
//
(function (Twig) {
    Twig.lib = {};
    Twig.lib.round = function (value, precision) {
        var m, f, isHalf, sgn; // helper variables

        // making sure precision is integer
        precision |= 0;
        m = Math.pow(10, precision);
        value *= m;

        // sign of the number
        sgn = value > 0 | -(value < 0);
        isHalf = value % 1 === 0.5 * sgn;
        f = Math.floor(value);

        if (isHalf) {
            value = f + (sgn > 0);
        }

        return (isHalf ? value : Math.round(value)) / m;
    };
    Twig.lib.strip_tags = function strip_tags(input, allowed) {
        allowed = (((allowed || '') + '').toLowerCase().match(/<[a-z][a-z0-9]*>/g) || []).join('');

        var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
        var commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;

        return input.replace(commentsAndPhpTags, '').replace(tags, function ($0, $1) {
            return allowed.indexOf('<' + $1.toLowerCase() + '>') > -1 ? $0 : '';
        });
    };
    Twig.lib.boolval = function boolval(mixedVar) {
        'use strict';

        // original by: Will Rowe
        //   example 1: boolval(true)
        //   returns 1: true
        //   example 2: boolval(false)
        //   returns 2: false
        //   example 3: boolval(0)
        //   returns 3: false
        //   example 4: boolval(0.0)
        //   returns 4: false
        //   example 5: boolval('')
        //   returns 5: false
        //   example 6: boolval('0')
        //   returns 6: false
        //   example 7: boolval([])
        //   returns 7: false
        //   example 8: boolval('')
        //   returns 8: false
        //   example 9: boolval(null)
        //   returns 9: false
        //   example 10: boolval(undefined)
        //   returns 10: false
        //   example 11: boolval('true')
        //   returns 11: true

        if (mixedVar === false) {
            return false;
        }

        if (mixedVar === 0 || mixedVar === 0.0) {
            return false;
        }

        if (mixedVar === '' || mixedVar === '0') {
            return false;
        }

        if (Array.isArray(mixedVar) && mixedVar.length === 0) {
            return false;
        }

        if (mixedVar === null || mixedVar === undefined) {
            return false;
        }

        return true;
    };
    Twig.lib.copy = function (src) {
        var target = {},
            key;
        for (key in src)
            target[key] = src[key];

        return target;
    };
    Twig.lib.extend = function (src, add) {
        var keys = Object.keys(add), i;

        i = keys.length;

        while (i--) {
            src[keys[i]] = add[keys[i]];
        }

        return src;
    };
    Twig.lib.replaceAll = function (string, search, replace) {
        return string.split(search).join(replace);
    };
    Twig.lib.strtotime = function strtotime(text, now) {
        //   example 1: strtotime('+1 day', 1129633200)
        //   returns 1: 1129719600
        //   example 2: strtotime('+1 week 2 days 4 hours 2 seconds', 1129633200)
        //   returns 2: 1130425202
        //   example 3: strtotime('last month', 1129633200)
        //   returns 3: 1127041200
        //   example 4: strtotime('2009-05-04 08:30:00 GMT')
        //   returns 4: 1241425800
        //   example 5: strtotime('2009-05-04 08:30:00+00')
        //   returns 5: 1241425800
        //   example 6: strtotime('2009-05-04 08:30:00+02:00')
        //   returns 6: 1241418600
        //   example 7: strtotime('2009-05-04T08:30:00Z')
        //   returns 7: 1241425800

        var parsed;
        var match;
        var today;
        var year;
        var date;
        var days;
        var ranges;
        var len;
        var times;
        var regex;
        var i;
        var fail = false;

        if (!text) return;

        // Unecessary spaces
        text = text.replace(/^\s+|\s+$/g, '').replace(/\s{2,}/g, ' ').replace(/[\t\r\n]/g, '').toLowerCase();

        // in contrast to php, js Date.parse function interprets:
        // dates given as yyyy-mm-dd as in timezone: UTC,
        // dates with "." or "-" as MDY instead of DMY
        // dates with two-digit years differently
        // etc...etc...
        // ...therefore we manually parse lots of common date formats
        var pattern = new RegExp(['^(\\d{1,4})', '([\\-\\.\\/:])', '(\\d{1,2})', '([\\-\\.\\/:])', '(\\d{1,4})', '(?:\\s(\\d{1,2}):(\\d{2})?:?(\\d{2})?)?', '(?:\\s([A-Z]+)?)?$'].join(''));
        match = text.match(pattern);

        if (match && match[2] === match[4]) {
            if (match[1] > 1901) {
                switch (match[2]) {
                    case '-':
                        // YYYY-M-D
                        if (match[3] > 12 || match[5] > 31) {
                            return fail;
                        }
                        return new Date(match[1], parseInt(match[3], 10) - 1, match[5], match[6] || 0, match[7] || 0, match[8] || 0, match[9] || 0) / 1000;
                    case '.':
                        // YYYY.M.D is not parsed by strtotime()
                        return fail;
                    case '/':
                        // YYYY/M/D
                        if (match[3] > 12 || match[5] > 31) {
                            return fail;
                        }
                        return new Date(match[1], parseInt(match[3], 10) - 1, match[5], match[6] || 0, match[7] || 0, match[8] || 0, match[9] || 0) / 1000;
                }
            } else if (match[5] > 1901) {
                switch (match[2]) {
                    case '-':
                        // D-M-YYYY
                        if (match[3] > 12 || match[1] > 31) {
                            return fail;
                        }
                        return new Date(match[5], parseInt(match[3], 10) - 1, match[1], match[6] || 0, match[7] || 0, match[8] || 0, match[9] || 0) / 1000;
                    case '.':
                        // D.M.YYYY
                        if (match[3] > 12 || match[1] > 31) {
                            return fail;
                        }
                        return new Date(match[5], parseInt(match[3], 10) - 1, match[1], match[6] || 0, match[7] || 0, match[8] || 0, match[9] || 0) / 1000;
                    case '/':
                        // M/D/YYYY
                        if (match[1] > 12 || match[3] > 31) {
                            return fail;
                        }
                        return new Date(match[5], parseInt(match[1], 10) - 1, match[3], match[6] || 0, match[7] || 0, match[8] || 0, match[9] || 0) / 1000;
                }
            } else {
                switch (match[2]) {
                    case '-':
                        // YY-M-D
                        if (match[3] > 12 || match[5] > 31 || match[1] < 70 && match[1] > 38) {
                            return fail;
                        }
                        year = match[1] >= 0 && match[1] <= 38 ? +match[1] + 2000 : match[1];
                        return new Date(year, parseInt(match[3], 10) - 1, match[5], match[6] || 0, match[7] || 0, match[8] || 0, match[9] || 0) / 1000;
                    case '.':
                        // D.M.YY or H.MM.SS
                        if (match[5] >= 70) {
                            // D.M.YY
                            if (match[3] > 12 || match[1] > 31) {
                                return fail;
                            }
                            return new Date(match[5], parseInt(match[3], 10) - 1, match[1], match[6] || 0, match[7] || 0, match[8] || 0, match[9] || 0) / 1000;
                        }
                        if (match[5] < 60 && !match[6]) {
                            // H.MM.SS
                            if (match[1] > 23 || match[3] > 59) {
                                return fail;
                            }
                            today = new Date();
                            return new Date(today.getFullYear(), today.getMonth(), today.getDate(), match[1] || 0, match[3] || 0, match[5] || 0, match[9] || 0) / 1000;
                        }

                        // invalid format, cannot be parsed
                        return fail;
                    case '/':
                        // M/D/YY
                        if (match[1] > 12 || match[3] > 31 || match[5] < 70 && match[5] > 38) {
                            return fail;
                        }
                        year = match[5] >= 0 && match[5] <= 38 ? +match[5] + 2000 : match[5];
                        return new Date(year, parseInt(match[1], 10) - 1, match[3], match[6] || 0, match[7] || 0, match[8] || 0, match[9] || 0) / 1000;
                    case ':':
                        // HH:MM:SS
                        if (match[1] > 23 || match[3] > 59 || match[5] > 59) {
                            return fail;
                        }
                        today = new Date();
                        return new Date(today.getFullYear(), today.getMonth(), today.getDate(), match[1] || 0, match[3] || 0, match[5] || 0) / 1000;
                }
            }
        }

        // other formats and "now" should be parsed by Date.parse()
        if (text === 'now') {
            return now === null || isNaN(now) ? new Date().getTime() / 1000 | 0 : now | 0;
        }
        if (!isNaN(parsed = Date.parse(text))) {
            return parsed / 1000 | 0;
        }

        // Browsers !== Chrome have problems parsing ISO 8601 date strings, as they do
        // not accept lower case characters, space, or shortened time zones.
        // Therefore, fix these problems and try again.
        // Examples:
        //   2015-04-15 20:33:59+02
        //   2015-04-15 20:33:59z
        //   2015-04-15t20:33:59+02:00
        pattern = new RegExp(['^([0-9]{4}-[0-9]{2}-[0-9]{2})', '[ t]', '([0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?)', '([\\+-][0-9]{2}(:[0-9]{2})?|z)'].join(''));
        match = text.match(pattern);
        if (match) {
            // @todo: time zone information
            if (match[4] === 'z') {
                match[4] = 'Z';
            } else if (match[4].match(/^([+-][0-9]{2})$/)) {
                match[4] = match[4] + ':00';
            }

            if (!isNaN(parsed = Date.parse(match[1] + 'T' + match[2] + match[4]))) {
                return parsed / 1000 | 0;
            }
        }

        date = now ? new Date(now * 1000) : new Date();
        days = {
            'sun': 0,
            'mon': 1,
            'tue': 2,
            'wed': 3,
            'thu': 4,
            'fri': 5,
            'sat': 6
        };
        ranges = {
            'yea': 'FullYear',
            'mon': 'Month',
            'day': 'Date',
            'hou': 'Hours',
            'min': 'Minutes',
            'sec': 'Seconds'
        };

        function lastNext(type, range, modifier) {
            var diff;
            var day = days[range];

            if (typeof day !== 'undefined') {
                diff = day - date.getDay();

                if (diff === 0) {
                    diff = 7 * modifier;
                } else if (diff > 0 && type === 'last') {
                    diff -= 7;
                } else if (diff < 0 && type === 'next') {
                    diff += 7;
                }

                date.setDate(date.getDate() + diff);
            }
        }

        function process(val) {
            // @todo: Reconcile this with regex using \s, taking into account
            // browser issues with split and regexes
            var splt = val.split(' ');
            var type = splt[0];
            var range = splt[1].substring(0, 3);
            var typeIsNumber = /\d+/.test(type);
            var ago = splt[2] === 'ago';
            var num = (type === 'last' ? -1 : 1) * (ago ? -1 : 1);

            if (typeIsNumber) {
                num *= parseInt(type, 10);
            }

            if (ranges.hasOwnProperty(range) && !splt[1].match(/^mon(day|\.)?$/i)) {
                return date['set' + ranges[range]](date['get' + ranges[range]]() + num);
            }

            if (range === 'wee') {
                return date.setDate(date.getDate() + num * 7);
            }

            if (type === 'next' || type === 'last') {
                lastNext(type, range, num);
            } else if (!typeIsNumber) {
                return false;
            }

            return true;
        }

        times = '(years?|months?|weeks?|days?|hours?|minutes?|min|seconds?|sec' + '|sunday|sun\\.?|monday|mon\\.?|tuesday|tue\\.?|wednesday|wed\\.?' + '|thursday|thu\\.?|friday|fri\\.?|saturday|sat\\.?)';
        regex = '([+-]?\\d+\\s' + times + '|' + '(last|next)\\s' + times + ')(\\sago)?';

        match = text.match(new RegExp(regex, 'gi'));
        if (!match) {
            return fail;
        }

        for (i = 0, len = match.length; i < len; i++) {
            if (!process(match[i])) {
                return fail;
            }
        }

        return date.getTime() / 1000;
    };
    Twig.lib.date = function date(format, timestamp) {
        //   example 1: date('H:m:s \\m \\i\\s \\m\\o\\n\\t\\h', 1062402400)
        //   returns 1: '07:09:40 m is month'
        //   example 2: date('F j, Y, g:i a', 1062462400)
        //   returns 2: 'September 2, 2003, 12:26 am'
        //   example 3: date('Y W o', 1062462400)
        //   returns 3: '2003 36 2003'
        //   example 4: var $x = date('Y m d', (new Date()).getTime() / 1000)
        //   example 4: $x = $x + ''
        //   example 4: var $result = $x.length // 2009 01 09
        //   returns 4: 10
        //   example 5: date('W', 1104534000)
        //   returns 5: '52'
        //   example 6: date('B t', 1104534000)
        //   returns 6: '999 31'
        //   example 7: date('W U', 1293750000.82); // 2010-12-31
        //   returns 7: '52 1293750000'
        //   example 8: date('W', 1293836400); // 2011-01-01
        //   returns 8: '52'
        //   example 9: date('W Y-m-d', 1293974054); // 2011-01-02
        //   returns 9: '52 2011-01-02'
        //        test: skip-1 skip-2 skip-5

        var jsdate, f;
        // Keep this here (works, but for code commented-out below for file size reasons)
        // var tal= [];
        var txtWords = ['Sun', 'Mon', 'Tues', 'Wednes', 'Thurs', 'Fri', 'Satur', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        // trailing backslash -> (dropped)
        // a backslash followed by any character (including backslash) -> the character
        // empty string -> empty string
        var formatChr = /\\?(.?)/gi;
        var formatChrCb = function formatChrCb(t, s) {
            return f[t] ? f[t]() : s;
        };
        var _pad = function _pad(n, c) {
            n = String(n);
            while (n.length < c) {
                n = '0' + n;
            }
            return n;
        };
        f = {
            // Day
            d: function d() {
                // Day of month w/leading 0; 01..31
                return _pad(f.j(), 2);
            },
            D: function D() {
                // Shorthand day name; Mon...Sun
                return f.l().slice(0, 3);
            },
            j: function j() {
                // Day of month; 1..31
                return jsdate.getDate();
            },
            l: function l() {
                // Full day name; Monday...Sunday
                return txtWords[f.w()] + 'day';
            },
            N: function N() {
                // ISO-8601 day of week; 1[Mon]..7[Sun]
                return f.w() || 7;
            },
            S: function S() {
                // Ordinal suffix for day of month; st, nd, rd, th
                var j = f.j();
                var i = j % 10;
                if (i <= 3 && parseInt(j % 100 / 10, 10) === 1) {
                    i = 0;
                }
                return ['st', 'nd', 'rd'][i - 1] || 'th';
            },
            w: function w() {
                // Day of week; 0[Sun]..6[Sat]
                return jsdate.getDay();
            },
            z: function z() {
                // Day of year; 0..365
                var a = new Date(f.Y(), f.n() - 1, f.j());
                var b = new Date(f.Y(), 0, 1);
                return Math.round((a - b) / 864e5);
            },

            // Week
            W: function W() {
                // ISO-8601 week number
                var a = new Date(f.Y(), f.n() - 1, f.j() - f.N() + 3);
                var b = new Date(a.getFullYear(), 0, 4);
                return _pad(1 + Math.round((a - b) / 864e5 / 7), 2);
            },

            // Month
            F: function F() {
                // Full month name; January...December
                return txtWords[6 + f.n()];
            },
            m: function m() {
                // Month w/leading 0; 01...12
                return _pad(f.n(), 2);
            },
            M: function M() {
                // Shorthand month name; Jan...Dec
                return f.F().slice(0, 3);
            },
            n: function n() {
                // Month; 1...12
                return jsdate.getMonth() + 1;
            },
            t: function t() {
                // Days in month; 28...31
                return new Date(f.Y(), f.n(), 0).getDate();
            },

            // Year
            L: function L() {
                // Is leap year?; 0 or 1
                var j = f.Y();
                return j % 4 === 0 & j % 100 !== 0 | j % 400 === 0;
            },
            o: function o() {
                // ISO-8601 year
                var n = f.n();
                var W = f.W();
                var Y = f.Y();
                return Y + (n === 12 && W < 9 ? 1 : n === 1 && W > 9 ? -1 : 0);
            },
            Y: function Y() {
                // Full year; e.g. 1980...2010
                return jsdate.getFullYear();
            },
            y: function y() {
                // Last two digits of year; 00...99
                return f.Y().toString().slice(-2);
            },

            // Time
            a: function a() {
                // am or pm
                return jsdate.getHours() > 11 ? 'pm' : 'am';
            },
            A: function A() {
                // AM or PM
                return f.a().toUpperCase();
            },
            B: function B() {
                // Swatch Internet time; 000..999
                var H = jsdate.getUTCHours() * 36e2;
                // Hours
                var i = jsdate.getUTCMinutes() * 60;
                // Minutes
                // Seconds
                var s = jsdate.getUTCSeconds();
                return _pad(Math.floor((H + i + s + 36e2) / 86.4) % 1e3, 3);
            },
            g: function g() {
                // 12-Hours; 1..12
                return f.G() % 12 || 12;
            },
            G: function G() {
                // 24-Hours; 0..23
                return jsdate.getHours();
            },
            h: function h() {
                // 12-Hours w/leading 0; 01..12
                return _pad(f.g(), 2);
            },
            H: function H() {
                // 24-Hours w/leading 0; 00..23
                return _pad(f.G(), 2);
            },
            i: function i() {
                // Minutes w/leading 0; 00..59
                return _pad(jsdate.getMinutes(), 2);
            },
            s: function s() {
                // Seconds w/leading 0; 00..59
                return _pad(jsdate.getSeconds(), 2);
            },
            u: function u() {
                // Microseconds; 000000-999000
                return _pad(jsdate.getMilliseconds() * 1000, 6);
            },

            // Timezone
            e: function e() {
                // Timezone identifier; e.g. Atlantic/Azores, ...
                // The following works, but requires inclusion of the very large
                // timezone_abbreviations_list() function.
                /*              return that.date_default_timezone_get();
                 */
                var msg = 'Not supported (see source code of date() for timezone on how to add support)';
                throw new Error(msg);
            },
            I: function I() {
                // DST observed?; 0 or 1
                // Compares Jan 1 minus Jan 1 UTC to Jul 1 minus Jul 1 UTC.
                // If they are not equal, then DST is observed.
                var a = new Date(f.Y(), 0);
                // Jan 1
                var c = Date.UTC(f.Y(), 0);
                // Jan 1 UTC
                var b = new Date(f.Y(), 6);
                // Jul 1
                // Jul 1 UTC
                var d = Date.UTC(f.Y(), 6);
                return a - c !== b - d ? 1 : 0;
            },
            O: function O() {
                // Difference to GMT in hour format; e.g. +0200
                var tzo = jsdate.getTimezoneOffset();
                var a = Math.abs(tzo);
                return (tzo > 0 ? '-' : '+') + _pad(Math.floor(a / 60) * 100 + a % 60, 4);
            },
            P: function P() {
                // Difference to GMT w/colon; e.g. +02:00
                var O = f.O();
                return O.substr(0, 3) + ':' + O.substr(3, 2);
            },
            T: function T() {
                // The following works, but requires inclusion of the very
                // large timezone_abbreviations_list() function.
                /*              var abbr, i, os, _default;
                 if (!tal.length) {
                 tal = that.timezone_abbreviations_list();
                 }
                 if ($locutus && $locutus.default_timezone) {
                 _default = $locutus.default_timezone;
                 for (abbr in tal) {
                 for (i = 0; i < tal[abbr].length; i++) {
                 if (tal[abbr][i].timezone_id === _default) {
                 return abbr.toUpperCase();
                 }
                 }
                 }
                 }
                 for (abbr in tal) {
                 for (i = 0; i < tal[abbr].length; i++) {
                 os = -jsdate.getTimezoneOffset() * 60;
                 if (tal[abbr][i].offset === os) {
                 return abbr.toUpperCase();
                 }
                 }
                 }
                 */
                return 'UTC';
            },
            Z: function Z() {
                // Timezone offset in seconds (-43200...50400)
                return -jsdate.getTimezoneOffset() * 60;
            },

            // Full Date/Time
            c: function c() {
                // ISO-8601 date.
                return 'Y-m-d\\TH:i:sP'.replace(formatChr, formatChrCb);
            },
            r: function r() {
                // RFC 2822
                return 'D, d M Y H:i:s O'.replace(formatChr, formatChrCb);
            },
            U: function U() {
                // Seconds since UNIX epoch
                return jsdate / 1000 | 0;
            }
        };

        var _date = function _date(format, timestamp) {
            jsdate = timestamp === undefined ? new Date() // Not provided
                : timestamp instanceof Date ? new Date(timestamp) // JS Date()
                    : new Date(timestamp * 1000) // UNIX timestamp (auto-convert to int)
            ;
            return format.replace(formatChr, formatChrCb);
        };

        return _date(format, timestamp);
    };

    return Twig;
})(Twig);


// require('./twig.parser.source')(Twig);
//
(function (Twig) {
    'use strict';

    Twig.Templates.registerParser('source', function (params) {
        return params.data || '';
    });
})(Twig);


// require('./twig.parser.twig')(Twig);
//
(function (Twig) {
    'use strict';

    Twig.Templates.registerParser('twig', function (params) {
        return new Twig.Template(params);
    });
})(Twig);


// ## twig.tests.js
//
// This file handles expression tests. (is empty, is not defined, etc...)
(function (Twig) {
    "use strict";
    Twig.tests = {
        empty: function (value) {
            if (value === null || value === undefined) return true;
            // Handler numbers
            if (typeof value === "number") return false; // numbers are never "empty"
            // Handle strings and arrays
            if (value.length && value.length > 0) return false;
            // Handle objects
            for (var key in value) {
                if (value.hasOwnProperty(key)) return false;
            }
            return true;
        },
        odd: function (value) {
            return value % 2 === 1;
        },
        even: function (value) {
            return value % 2 === 0;
        },
        divisibleby: function (value, params) {
            return value % params[0] === 0;
        },
        defined: function (value) {
            return value !== undefined;
        },
        none: function (value) {
            return value === null;
        },
        'null': function (value) {
            return this.none(value); // Alias of none
        },
        'same as': function (value, params) {
            return value === params[0];
        },
        iterable: function (value) {
            return value && (Twig._is("Array", value) || Twig._is("Object", value));
        }
    };

    Twig.test = function (test, value, params) {
        if (!Twig.tests[test]) {
            throw "Test " + test + " is not defined.";
        }
        return Twig.tests[test](value, params);
    };

    Twig.test.extend = function (test, definition) {
        Twig.tests[test] = definition;
    };

    return Twig;
})(Twig);


// ## twig.exports.js
//
// This file provides extension points and other hooks into the twig functionality.
(function (Twig) {
    "use strict";
    Twig.exports = {
        VERSION: Twig.VERSION
    };

    /**
     * Create and compile a twig.js template.
     * @param {Object} param Paramteres for creating a Twig template.
     * @return {Twig.Template} A Twig template ready for rendering.
     */
    Twig.exports.twig = function twig(params) {
        'use strict';
        var id = params.id,
            options = {
                strict_variables: params.strict_variables || false,
                autoescape: params.autoescape != null && params.autoescape || false,
                rethrow: params.rethrow || false
            };

        if (params.debug !== undefined) {
            Twig.debug = params.debug;
        }
        if (params.trace !== undefined) {
            Twig.trace = params.trace;
        }

        return Twig.Templates.parsers.twig({
            data: params.data,
            path: params.hasOwnProperty('path') ? params.path : undefined,
            id: id,
            options: options
        });
    };

    // Extend Twig with a new filter.
    Twig.exports.extendFilter = function (filter, definition) {
        Twig.filter.extend(filter, definition);
    };

    // Extend Twig with a new function.
    Twig.exports.extendFunction = function (fn, definition) {
        Twig._function.extend(fn, definition);
    };

    // Extend Twig with a new test.
    Twig.exports.extendTest = function (test, definition) {
        Twig.test.extend(test, definition);
    };

    // Provide an environment for extending Twig core.
    // Calls fn with the internal Twig object.
    Twig.exports.extend = function (fn) {
        fn(Twig);
    };

    //Export our filters.
    Twig.exports.filters = Twig.filters;

    //Export our libs.
    Twig.exports.lib = Twig.lib;

    return Twig;
})(Twig);


module.exports = Twig.exports;