"use strict";

var debug                   = require('debug')('roon-extension-denon-telnet')
  , info                    = require('debug')('roon-extension-denon-telnet:info')
  , warn                    = require('debug')('roon-extension-denon-telnet:warn')
  , RoonApi                 = require('node-roon-api')
  , RoonApiSettings         = require('node-roon-api-settings')
  , RoonApiStatus           = require('node-roon-api-status')
  , RoonApiVolumeControl    = require('node-roon-api-volume-control')
  , RoonApiSourceControl    = require('node-roon-api-source-control')
  , AVRAsyncHelper          = require('./lib/DenonAsyncHelper.js');

var avr = {};
var roon = new RoonApi({
    extension_id: 'org.blievers.roon.denon',
    display_name: 'Denon AVR-X4800H',
    display_version: '0.0.3',
    publisher: 'Denon AVR-X4800H',
    email: 'nickblievers@gmail.com',
    website: 'https://github.com/ascl00',
    log_level: 'info',
});

// Load the settings or initialise to empty strings
var mysettings = roon.load_config("settings") || {
    hostname: "",
    setsource: "",
};

function make_layout(settings)
{
    debug("Inside make_layout passed %o", settings);
    var l = {
        values: settings,
        layout: [],
        has_error: false
    };

    l.layout.push({
        type: "string",
        title: "Host name or IP Address",
        subtitle: "The IP address or hostname of the Denon/Marantz receiver.",
        maxlength: 256,
        setting: "hostname",
    });
    l.layout.push({
        type:    "dropdown",
        title:   "Source",
        subtitle: "The source Roon uses on your Denon/Marantz receiver (ie 'CD')",
        values:  [
            { value: 'CD',      title: 'CD' },
            { value: 'SPOTIFY', title: 'SPOTIFY' },
            { value: 'CBL/SAT', title: 'CBL/SAT' },
            { value: 'DVD',     title: 'DVD' },
            { value: 'BD',      title: 'BD' },
            { value: 'GAME',    title: 'GAME' },
            { value: 'GAME2',   title: 'GAME2' },
            { value: 'AUX1',    title: 'AUX1' },
            { value: 'MPLAY',   title: 'MPLAY' },
            { value: 'USB/IPOD',title: 'USB/IPOD' },
            { value: 'TUNER',   title: 'TUNER' },
            { value: 'NETWORK', title: 'NETWORK' },
            { value: 'TV',      title: 'TV' },
            { value: 'IRADIO',  title: 'IRADIO' },
            { value: 'SAT/CBL', title: 'SAT/CBL' },
            { value: 'DOCK',    title: 'DOCK' },
            { value: 'NET/USB', title: 'NET/USB' },
        ],
        setting: "setsource",
    });

    return l;
}

var svc_settings        = new RoonApiSettings(roon,{
    get_settings: function(req) {
        info("Inside get_settings()");
        debug("myvalues: %o", mysettings);

        // TODO: Why don't we need to call req.send_complete here?
        req(make_layout(mysettings));
    },
    save_settings: function(req, isdryrun, settings) {
        info("Inside save_settings()");

        let l = make_layout(settings.values);

        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error)
        {
            debug("Inside save_settings() - no errors, save that sucker");
            debug("lvalues: %o", l.values);
            debug("myvalues: %o", mysettings.values);
            debug("values: %o", settings.values);

            if (!mysettings.id)
                mysettings.id = Math.floor(Math.random() * 65536);
            let _name = mysettings.displayname;
            let _id = mysettings.id;

            mysettings = l.values;
            mysettings.id = _name == mysettings.displayname ? _id : Math.floor(Math.random() * 65536);

            svc_settings.update_settings(l);
            roon.save_config("settings", mysettings);
            debug("Inside save_settings() - initiate connection to: " + mysettings.hostname);

            setup_denon_connection(mysettings.hostname);
        }
    }
    /*
    TODO: Add buttons to probe UPNP to find AVR
    button_pressed: function(req, buttonid, settings) {
        info(req + ":" + buttonid + ":" + settings);
    } */
});

var svc_status          = new RoonApiStatus(roon);
var svc_volume_control  = new RoonApiVolumeControl(roon);
var svc_source_control  = new RoonApiSourceControl(roon);

roon.init_services({
    provided_services: [svc_status, svc_settings, svc_volume_control, svc_source_control]
});

async function setup_denon_connection(host)
{
    info("setup_denon_connection (" + host + ")");

    if (!host)
    {
        warn("Not configured, please check settings");
        svc_status.set_status("Not configured, please check settings.", true);
    }
    else
    {
        debug("Connecting to receiver...");
        svc_status.set_status("Connecting to " + host + " ...", false);
        avr.client = AVRAsyncHelper.GetClient(host);
        try
        {
            let state = await AVRAsyncHelper.UpdateState(avr.client);
            if(!state)
            {
                svc_status.set_status("Failed to collect state info", true);
            }
            else
            {
                svc_status.set_status("Collected state info", false);
                if(avr.volume_control) { avr.volume_control.destroy(); delete(avr.volume_control); }
                if(avr.source_control) { avr.source_control.destroy(); delete(avr.source_control); }
                let volume_control = await create_volume_control(avr, state.volume_state);
                avr.volume_control = volume_control;
                let source_control = await create_source_control(avr, state.source_state);
                avr.source_control = source_control;
            }
        }
        catch(ex)
        {
                svc_status.set_status("Failed to connect to " + host + " with " + ex.message, false);
                warn("Error setting up connection: %o", ex);
        }
    }
}

function check_status(power, input)
{
    info("check_status: %o - %o", power, input);
    let stat = 'indeterminate';
    if (power == "ON")
    {
        if (input == mysettings.setsource)
        {
            stat = "selected";
        }
        else
        {
            stat = "deselected";
        }
    }
    else
    {
        stat = "standby";
    }
    debug("Receiver Status: %s", stat);
    return stat;
}

async function create_volume_control(avr, state)
{
    info("create_volume_control: volume_control with state %o ", state);

    var volume_device =
    {
        state: {
                display_name    : "Main Zone",
                volume_type     : "db",
                volume_min      : -79.5,
                volume_max      : 0,
                volume_step     : 0.5,
                is_muted        : state.is_muted,
                volume_value    : state.volume_value
        },
        set_volume: async function(req, mode, value)
        {
            info("set_volume: mode=%s value=%d", mode, value);

            let newvol = mode == "absolute" ? value : (state.volume_value + value);
            if (newvol < this.state.volume_min)
                newvol = this.state.volume_min;
            else if (newvol > this.state.volume_max)
                newvol = this.state.volume_max;

            let volume = await AVRAsyncHelper.SetVolume(avr.client, newvol);
            if(volume)
            {
                debug("set_volume: Succeeded.");
                this.state.volume_value = newvol;
                req.send_complete("Success");
            }
            else
            {
                warn("set_volume: Failed with error") /*, error); */
                req.send_complete("Failed");
            }
            avr.volume_control.update_state({ volume_value: this.state.volume_value });
        },
        set_mute: async function(req, action)
        {
            info("set_mute: action=%s", action);

            const cmd = !this.state.is_muted ? "on" : "off";
            let mute_state = await AVRAsyncHelper.SetMuteState(avr.client, cmd);
            if(mute_state !== null)
            {
                debug("set_mute: Succeeded setting: %o", action ? "Mute" : "Unmute");
                this.state.is_muted = cmd;
                req.send_complete("Success");
            }
            else
            {
                warn("set_mute: Failed with error");
                req.send_complete("Failed");
            }
            avr.volume_control.update_state({ is_muted: this.state.is_muted });
        }
    };

    var volume_control = svc_volume_control.new_device(volume_device);
    svc_status.set_status("Updated AVR State", false);
    debug("Registered volume control %o", volume_device);
    return volume_control;
}

function sleep(ms)
{
    // a use for promise!
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function create_source_control(avr, state)
{
    info("create_source_control: source_control=" + avr.source_control)
    var source_state =
    {
        display_name    : "Main Zone",
        supports_standby: true,
        status          : check_status(state.power, state.input),
        power           : state.power,
        input           : state.input,
    };

    var device =
    {
        state: source_state,
        convenience_switch: async function(req)
        {
            info("convenience_switch called");
            if (this.state.power === "STANDBY")
            {
                debug("AVR on standby, attemping to switch ON");
                let res = await AVRAsyncHelper.SetPowerState(avr.client, true);
                if(res)
                {
                    this.state.power = "ON";
                    avr.source_control.update_state({ power: this.state.power });
                    // The AVR takes a while to wake up, so hang around for a bit while it does
                    await sleep(10000);
                }
                else
                {
                    req.send_complete('Failed');
                    return; // No point continuing if power on failed
                }
            }

            let input = await AVRAsyncHelper.GetInput(avr.client);
            if (input == mysettings.setsource)
            {
                debug("AVR on appropriate input:" + input);
                req.send_complete("Success");
            }
            else
            {
                debug("AVR on has input of:" + input + " but we need:" + mysettings.setsource);
                let input_switch_result = await AVRAsyncHelper.SetInput(avr.client, mysettings.setsource);

                if(input_switch_result)
                {
                    this.state.input = mysettings.sersource;
                    req.send_complete("Success");
                }
                else
                {
                    req.send_complete('Failed');
                }
            }
            avr.source_control.update_state({
                input: this.state.input,
                power: this.state.power,
                status: check_status(this.state.power, this.state.input)
            });
        },
        standby: async function(req)
        {
            info("In standby callback");
            let res = await AVRAsyncHelper.SetPowerState(avr.client, false);
            if(res !== null)
            {
                req.send_complete("Success");
                this.state.power = 'STANDBY';
            }
            else
            {
                req.send_complete('Failed');
            }
            avr.source_control.update_state({
                input: this.state.input,
                power: this.state.power,
                status: check_status(this.state.power, this.state.input)
            });
        }
    };
    var source_control = svc_source_control.new_device(device);
    debug("Registering source control extension: %o", device);
    return source_control;
}

setup_denon_connection(mysettings.hostname);

var intervalObject = setInterval(async function(avr) {
        debug("Timer based state check");

        var state = await AVRAsyncHelper.UpdateState(avr.client);
        if(!state)
        {
            debug("Failed to get state in timer");
            return false;
        }
        if(avr.source_control)
        {
            avr.source_control.update_state({
                        power: state.source_state.power,
                        input: state.source_state.input,
                        status: check_status(state.source_state.power, state.source_state.input)
                    });
        }
        if(avr.volume_control)
        {
            avr.volume_control.update_state({
                        volume_value: state.volume_state.volume_value,
                        is_muted: state.volume_state.is_muted
                    });
        }
    }, 30000, avr);

    // clearInterval(obj)


roon.start_discovery();
