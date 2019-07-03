"use strict";

const debug = require("debug")("bot-express:bot");
const Translator = require("./translator");

/**
 * Toolkit to be used by skill.
 * @class
 * @prop {String} type - Type of messenger. The value can be "line","facebook" and "google".
 * @prop {String} language - ISO-639-1 based language code which is the mother language of this chatbot.
 * @prop {Object} builtin_parser - Instance of builtin parser. You can use builtin parser like follows. await bot.builtin_parser.PARSER_NAME(value, policy).
 */
class Bot {
    /**
     * @constructor
     * @param {Object} options 
     * @param {Object} slib
     * @param {Object} event 
     * @param {Object} context 
     */
    constructor(options, slib, event, context){
        this.type = slib.messenger.type;
        this.language = options.language;
        for (let messenger_type of Object.keys(slib.messenger.plugin)){
            this[messenger_type] = slib.messenger.plugin[messenger_type];
        }
        this.builtin_parser = slib.parser;
        this._options = options;
        this._slib = slib;
        this._event = event;
        this._context = context;
        this.translator = new Translator(this._context, this._options.translator);
    }

    /**
     * Alias to this.translator.t
     * @method
     * @async
     * @param {String} key
     * @param {Object} options
     * @return {String} Translation label.
     */
    async t(key, options){
        return this.translator.get_translation_label(key, options);
    }

    /**
    * Reply messages to sender to collect parameter
    * @method
    * @async
    * @param {Array.<MessageObject>} messages - The array of message objects.
    * @return {Object} - Response from Messenger API.
    */
    async reply_to_collect(messages){
        return this.reply(messages, true)
    }

    /**
    * Reply message to sender. This function can be called just once in a flow. To send multiple messages, give multiple messages to this function or use queue(MESSAGES) function instead.
    * @method
    * @async
    * @param {MessageObject|Array.<MessageObject>} messages - Message object[s] to reply.
    * @return {Object} - Response from Messenger API.
    */
    async reply(messages, to_collect = false){
        if (messages){
            this.queue(messages);
        }

        let done_compile_messages = [];
        for (let message of this._context._message_queue){
            done_compile_messages.push(this._slib.messenger.compile_message(message));
        }

        const compiled_messages = await Promise.all(done_compile_messages);

        let response;
        if (this._event.type == "bot-express:push"){
            response = await this._slib.messenger.send(this._event, this._event.to[`${this._event.to.type}Id`], compiled_messages);
        } else if (to_collect || this._context._digging){
            response = await this._slib.messenger.reply_to_collect(this._event, compiled_messages);
        } else {
            response = await this._slib.messenger.reply(this._event, compiled_messages);
        }

        for (let compiled_message of compiled_messages){
            this._context.previous.message.unshift({
                from: "bot",
                message: compiled_message,
                skill: this._context.skill.type
            });

            await this._slib.logger.chat(this.extract_channel_id(), this.extract_sender_id(), this._context.chat_id, this._context.skill.type, "bot", compiled_message);
        }
        this._context._message_queue = [];

        return response;
    }

    /**
    * Send(Push) message to specified user.
    * @method
    * @async
    * @param {String} recipient_id - Recipient user id.
    * @param {MessageObject|Array.<MessageObject>} messages - Messages object[s] to send.
    * @param {String} language - ISO-639-1 based language code to translate to.
    * @return {Object} - Response from Messenger API.
    */
    async send(recipient_id, messages, language){
        // If messages is not array, we make it array.
        if (messages.length === undefined){
            messages = [messages];
        }

        let done_compile_messages = [];
        for (let message of messages){
            done_compile_messages.push(this.compile_message(message));
        }

        const compiled_messages = await Promise.all(done_compile_messages);
        const response = await this._slib.messenger.send(this._event, recipient_id, compiled_messages);

        for (let compiled_message of compiled_messages){
            this._context.previous.message.unshift({
                from: "bot",
                message: compiled_message,
                skill: this._context.skill.type
            });

            await this._slib.logger.chat(this.extract_channel_id(), this.extract_sender_id(), this._context.chat_id, this._context.skill.type, "bot", compiled_message);
        }

        return response;
    }

    /**
    * Send(Push) messages to multiple users.
    * @method
    * @async
    * @param {Array.<String>} recipient_ids - Array of recipent user id.
    * @param {MessageObject|Array.<MessageObject>} messages - Message object[s] to send.
    * @param {String} language - ISO-639-1 based language code to translate to.
    * @return {Object} - Response from Messenger API.
    */
    async multicast(recipient_ids, messages, language){
        // If messages is not array, we make it array.
        if (messages.length === undefined){
            messages = [messages];
        }

        let done_compile_messages = [];
        for (let message of messages){
            done_compile_messages.push(this.compile_message(message));
        }

        const compiled_messages = await Promise.all(done_compile_messages);
        const response = await this._slib.messenger.multicast(this._event, recipient_ids, compiled_messages);

        for (let compiled_message of compiled_messages){
            this._context.previous.message.unshift({
                from: "bot",
                message: compiled_message,
                skill: this._context.skill.type
            });

            await this._slib.logger.chat(this.extract_channel_id(), this.extract_sender_id(), this._context.chat_id, this._context.skill.type, "bot", compiled_message);
        }

        return response;
    }

    /**
     * Switch skill using provided intent. If this method is called in the middle of flow, rest of the process is skipped.
     * @method
     * @param {intent} intent 
     */
    switch_skill(intent){
        this.exit();

        if (!(intent.name && typeof intent.name === "string")){
            throw new Error("Required parameter: 'name' for switch_skill() should be set and string.");
        }
        
        this._context._switch_intent = intent;
    }

    /**
     * Queue messages. The messages will be sent out when reply(MESSAGES) function is called.
     * @method
     * @param {MessageObject|Array.<MessageObject>} messages - Message object[s] to queue.
     */
    queue(messages){
        if (typeof this._context._message_queue == "undefined"){
            this._context._message_queue = [];
        }
        this._context._message_queue = this._context._message_queue.concat(messages);
    }

    /**
     * Stop processing all remaining actions and keep context.
     * @method
     */
    pause(){
        this._context._pause = true;
    }

    /**
     * Stop processing all remaining actions and keep context except for confirming.
     * @method
     */
    exit(){
        this._context._exit = true;
    }

    /**
     * Stop processing all remaining actions and clear context completely.
     * @method
     */
    init(){
        this._context._init = true;
    }

    /**
     * Check parameter type.
     * @method
     * @param {String} param_name - Parameter name.
     * @returns {String} "required_parameter" | "optional_parameter" | "dynamic_parameter" | "sub_parameter" | "not_applicable"
     */
    check_parameter_type(param_name){
        if (this._context.skill.required_parameter && this._context.skill.required_parameter[param_name]){
            return "required_parameter";
        } else if (this._context.skill.optional_parameter && this._context.skill.optional_parameter[param_name]){
            return "optional_parameter";
        } else if (this._context.skill.dynamic_parameter && this._context.skill.dynamic_parameter[param_name]){
            return "dynamic_parameter";
        } else if (this._context._sub_parameter){
            return "sub_parameter";
        }

        return "not_applicable";
    }

    /**
     * Wrapper of change_message for backward compatibility.
     * @method
     * @param {String} param_name - Name of the parameter to collect.
     * @param {MessageObject} message - The message object.
     */
    change_message_to_confirm(param_name, message){
        this.change_message(param_name, message);
    }

    /**
     * Change the message to collect specified parameter.
     * @method
     * @param {String} param_name - Name of the parameter to collect.
     * @param {MessageObject} message - The message object.
     */
    change_message(param_name, message){
        let param_type = this.check_parameter_type(param_name);

        if (param_type == "not_applicable"){
            debug("The parameter to change message not found.");
            throw new Error("The parameter to change message not found.")
        }

        this._context.skill[param_type][param_name].message = message;

        // Record this change.
        debug(`Saving change log to change_parameter_history...`);
        this._save_param_change_log(param_type, param_name, {message: message});
    }

    /**
     * Get parameter object by parameter name. 
     * @param {String} param_name 
     * @return {Object} Parameter object.
     */
    get_parameter(param_name){
        const param = {};
        param.name = param_name;
        param.type = this.check_parameter_type(param.name);

        if (param.type === "not_applicable"){
            throw new Error(`Paramter: "${param.name}" not found in skill.`);
        }

        if (param.type === "sub_parameter"){
            // Pick up sub parameter.
            Object.assign(param, this._context.skill[this._context._parent_parameter.type][this._context._parent_parameter.name].sub_parameter[param.name]);
        } else {
            // Pick up parameter.
            Object.assign(param, this._context.skill[param.type][param.name]);
        }

        return param;
    }
    
    /**
     * Manually apply value to the parameter. We can select if parser and reaction would be conducted. 
     * @method
     * @async
     * @param {String} param_name - Name of the parameter to apply.
     * @param {*} param_value - Value to apply.
     * @param {Boolean} [parse=false] - Whether to run parser.
     * @param {Boolean} [react=true] - Whether to run reaction.
     */ 
    async apply_parameter(param_name, param_value, parse = false, react = true){
        // Parse parameter.
        let parse_error;
        if (parse){
            try {
                param_value = await this.parse_parameter(param_name, param_value);
            } catch (e){
                if (e.name === "Error"){
                    // This should be intended exception in parser.
                    parse_error = e;
                    debug(`Parser rejected following value for parameter: "${param_name}".`);
                    debug(param_value);
                    if (e.message){
                        debug(e.message);
                    }
                } else {
                    // This should be unexpected exception so we just throw error.
                    throw e;
                }
            }
        }

        // Add parameter to context.
        this.add_parameter(param_name, param_value);

        // Take reaction.
        if (react){
            await this.react(parse_error, param_name, param_value);
        }
    }

    /**
     * Run parser defined in skill.
     * @method
     * @async
     * @param {String} param_name - Parameter name.
     * @param {*} param_value - Value to validate.
     * @param {Boolean} [strict=false] - If true, reject if parser does not exist. This option is for imternal use.
     * @returns {*}
    */
    async parse_parameter(param_name, param_value, strict = false){
        debug(`Parsing following value for parameter "${param_name}"`);
        debug(JSON.stringify(param_value));

        const param = this.get_parameter(param_name);

        let parser;
        if (param.parser){
            debug("Parse method found in parameter definition.");
            parser = param.parser;
        } else if (this._context.skill["parse_" + param_name]){
            debug("Parse method found in default parser function name.");
            parser = this._context.skill["parse_" + param_name];
        } else {
            if (strict){
                throw new Error("Parser not found.");
            }
            debug("Parse method NOT found. We use the value as it is as long as the value is set.");
            if (param_value === undefined || param_value === null || param_value === ""){
                throw new Error("Value is not set.");
            }
            debug(`Parser accepted the value.`);
            return param_value;
        }

        // As parser, we support 3 types which are function, string and object.
        // In case of function, we use it as it is.
        // In case of string and object, we use builtin parser.
        // As for the object, following is the format.
        // @param {Object} parser
        // @param {String} parser.type - Type of builtin parser. Supported value is dialogflow.
        // @param {String} parser.policy - Policy configuration depending on the each parser implementation.
        if (typeof parser === "function"){
            // We use the defined function.
            debug(`Parser is function so we use it as it is.`)
            return parser(param_value, this, this.event, this._context);
        } else if (typeof parser === "string"){
            // We use builtin parser.
            debug(`Parser is string so we use builtin parser: ${parser}.`);
            return this.builtin_parser[parser].parse(param_value, { parameter_name: param_name });
        } else if (typeof parser === "object"){
            // We use builtin parser.
            if (!parser.type){
                throw new Error(`Parser object is invalid. Required property: "type" not found.`);
            }
            debug(`Parser is object so we use builtin parser: ${parser.type}.`);

            // Add parameter_name to policy if it is not set.
            if (!parser.policy) parser.policy = {};
            parser.policy.parameter_name = parser.policy.parameter_name || param_name;

            return this.builtin_parser[parser.type].parse(param_value, parser.policy);
        } else {
            // Invalid parser.
            throw new Error(`Parser for the parameter: ${param_name} is invalid.`);
        }
    }


    /**
     * Add parameter to context as confirmed.
     * @method
     * @param {String} param_name 
     * @param {*} param_value 
     * @param {Boolean} [is_change]
     */
    add_parameter(param_name, param_value, is_change = false){
        debug(`Adding ${JSON.stringify(param_value)} to parameter: ${param_name}..`)

        const param = this.get_parameter(param_name);

        // Add the parameter to context.confirmed.
        // If the parameter should be list, we add value to the list.
        // IF the parameter should not be list, we just set the value.
        if (param.list){
            debug(`This param is list so we push/unshift value.`);
            if (!(typeof param.list === "boolean" || typeof param.list === "object")){
                throw new Error("list property should be boolean or object.");
            }

            if (!Array.isArray(this._context.confirmed[param_name])){
                this._context.confirmed[param_name] = [];
            }
            if (param.list === true){
                this._context.confirmed[param_name].unshift(param_value);
            } else if (param.list.order === "new"){
                this._context.confirmed[param_name].unshift(param_value);
            } else if (param.list.order === "old"){
                this._context.confirmed[param_name].push(param_value);
            } else {
                this._context.confirmed[param_name].unshift(param_value);
            }
        } else {
            this._context.confirmed[param_name] = param_value;
        }

        // At the same time, add the parameter name to previously confirmed list. The order of this list is newest first.
        if (!is_change){
            this._context.previous.confirmed.unshift(param_name);
            this._context.previous.processed.unshift(param_name);
        }

        // Remove item from to_confirm.
        let index_to_remove = this._context.to_confirm.indexOf(param_name);
        if (index_to_remove !== -1){
            debug(`Removing ${param_name} from to_confirm.`);
            this._context.to_confirm.splice(index_to_remove, 1);
        }

        // Clear confirming.
        if (this._context.confirming === param_name){
            debug(`Clearing confirming.`);
            this._context.confirming = null;
        }
    }

    /**
     * Run reaction defined in skill.
     * @method
     * @async
     * @param {Error} error
     * @param {String} param_name 
     * @param {*} param_value
     */
    async react(error, param_name, param_value){
        // If pause or exit flag found, we skip remaining process.
        if (this._context._pause || this._context._exit || this._context._init){
            debug(`Detected pause or exit or init flag so we skip reaction.`);
            return;
        }

        const param = this.get_parameter(param_name);

        if (param.reaction){
            debug(`Reaction for ${param_name} found. Performing reaction...`);
            await param.reaction(error, param_value, this, this.event, this._context);
        } else if (this._context.skill["reaction_" + param_name]){
            debug(`Reaction for ${param_name} found. Performing reaction...`);
            await this._context.skill["reaction_" + param_name](error, param_value, this, this.event, this._context);
        } else {
            // This parameter does not have reaction so do nothing.
            debug(`Reaction for ${param_name} not found.`);
        }
    }

    /**
     * Function to record the change log to revive this change into skill instance in the next event.
     * @method
     * @private
     * @param {String} param_type - required_parameter | optional_parameter | dynamic_parameter
     * @param {String} param_name - Name of the parameter.
     * @param {Skill#skill_parameter} param - Skill parameter object.
     */
    _save_param_change_log(param_type, param_name, param_orig){
        // We copy param_orig to param to prevent propagate the change in this function to original object.
        let param = Object.assign({}, param_orig);

        if (!this._context.param_change_history){
            this._context.param_change_history= [];
        }

        if (param.message || param.message_to_confirm){
            if (param.message && typeof param.message === "function"){
                param.message = param.message.toString();
            } else if (param.message_to_confirm && typeof param.message_to_confirm === "function"){
                param.message = param.message_to_confirm.toString();
            }
        }
        if (param.condition){
            if (typeof param.condition === "function"){
                param.condition = param.condition.toString();
            }
        }
        if (param.parser){
            if (typeof param.parser === "function"){
                param.parser = param.parser.toString();
            }
        }
        if (param.reaction){
            param.reaction = param.reaction.toString();
        }

        this._context.param_change_history.unshift({
            type: param_type,
            name: param_name,
            param: param
        });
    }

    /**
     * Make the specified skill paramter being collected next.
     * @method
     * @param {String|Skill#skill_parameter_container} arg - Name of the skill parameter or skill_parameter_container object to collect.
     * @param {Object} [options] - Option object.
     * @param {Boolean} [options.dedup=true] - Set false to allow collecting same parameter multiple times.
     */
    collect(arg, options = {}){
        if (options.dedup === undefined || options.dedup === null){
            options.dedup = true;
        }

        let param_name;

        if (typeof arg == "string"){
            debug(`Reserving collection of parameter: ${arg}.`);
            param_name = arg;
        } else if (typeof arg == "object"){
            if (Object.keys(arg).length !== 1){
                throw("Malformed parameter container object. You can pass just 1 parameter.");
            }

            debug(`Reserving collection of parameter: ${Object.keys(arg)[0]}.`);
            let parameter_container = arg;
            param_name = Object.keys(parameter_container)[0];
    
            if (this._context.skill.required_parameter && this._context.skill.required_parameter[param_name]){
                // If we have parameter of same parameter name, override it.
                debug(`Found the parameter in required_parameter so we override it.`);
                Object.assign(this._context.skill.required_parameter, parameter_container);
                this._save_param_change_log("required_parameter", param_name, parameter_container[param_name]);
            } else if (this._context.skill.optional_parameter && this._context.skill.optional_parameter[param_name]){
                // If we have parameter of same parameter name, override it.
                debug(`Found the parameter in optional_parameter so we override it.`);
                Object.assign(this._context.skill.optional_parameter, parameter_container);
                this._save_param_change_log("optional_parameter", param_name, parameter_container[param_name]);
            } else {
                // If we do not have parameter of same parameter name, add it as dynamic parameter.
                debug(`The parameter not found in skill so we add it as dynamic parameter.`);
                if (this._context.skill.dynamic_parameter === undefined) this._context.skill.dynamic_parameter = {};
                Object.assign(this._context.skill.dynamic_parameter, parameter_container);
                this._save_param_change_log("dynamic_parameter", param_name, parameter_container[param_name]);
            }
        } else {
            throw(new Error("Invalid argument."));
        }

        // If the parameter is already in the to_confirm list and dedup is true, we remove it to avoid duplicate.
        let index_to_remove = this._context.to_confirm.indexOf(param_name);
        if (index_to_remove !== -1 && options.dedup){
            debug(`We found this parameter has already been confirmed so remove ${param_name} from to_confirm to dedup.`);
            this._context.to_confirm.splice(index_to_remove, 1);
        }

        debug(`Reserved collection of parameter: ${param_name}. We put it to the top of to_confirm list.`);
        this._context.to_confirm.unshift(param_name);
    }

    /**
     * Extract message of the event.
     * @method
     * @param {EventObject} event - Event to extract message.
     * @returns {MessageObject} - Extracted message.
     */
    extract_message(event = this._event){
        return this._slib.messenger.extract_message(event);
    }

    /**
     * Extract message text.
     * @method
     * @param {EventObject} event - Event to extract message text.
     * @returns {String} - Extracted message text.
     */
    extract_message_text(event = this._event){
        return this._slib.messenger.extract_message_text(event);
    }

    /**
    * Extract sender's user id.
    * @method
    * @param {EventObject} event - Event to extract message text.
    * @returns {String} - Extracted sender's user id.
    */
    extract_sender_id(event = this._event){
        return this._slib.messenger.extract_sender_id(event);
    }

    /**
    * Extract session id.
    * @method
    * @param {EventObject} event - Event to extract message text.
    * @returns {String} - Extracted sender's user id.
    */
    extract_session_id(event = this._event){
        return this._slib.messenger.extract_session_id(event);
    }

    /**
    * Extract channel id.
    * @method
    * @param {Object} event - Event to extract channel id.
    * @returns {String} - Extracted channel id.
    */
    extract_channel_id(event = this._event){
        return this._slib.messenger.extract_channel_id(event);
    }

    /**
    * Identify the event type.
    * @method
    * @param {EventObject} event - Event to identify event type.
    * @returns {String} - Event type. In case of LINE, it can be "message", "follow", "unfollow", "join", "leave", "postback", "beacon". In case of Facebook, it can be "echo", "message", "delivery", "read", "postback", "optin", "referral", "account_linking".
    */
    identify_event_type(event = this._event){
        return this._slib.messenger.identify_event_type(event);
    }

    /**
    * Identify the message type.
    * @method
    * @param {MessageObject} message - Message Object to identify message type.
    * @returns {String} - Message type. In case of LINE, it can be "text", "image", "audio", "video", "file", "location", "sticker", "imagemap", "buttons_template, "confirm_template" or "carousel_template". In case of Facebook, it can be "text", "image", "audio", "video", "file", "button_template", "generic_template", "list_template", "open_graph_template", "receipt_template", "airline_boardingpass_template", "airline_checkin_template", "airline_itinerary_template", "airline_update_template".
    */
    identify_message_type(message){
        if (!message){
            message = this.extract_message();
        }
        return this._slib.messenger.identify_message_type(message);
    }

    /**
    * Compile message format to the specified format.
    * @method
    * @param {MessageObject} message - Message object to compile.
    * @param {String} format - Target format to compile. It can be "line" or "facebook".
    * @returns {Promise.<MessageObject>} - Compiled message object.
    */
    compile_message(message, format = this.type){
        return this._slib.messenger.compile_message(message, format);
    }
}
module.exports = Bot;
