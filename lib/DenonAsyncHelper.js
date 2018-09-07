"use strict";
var DenonAsyncHelper = {};

DenonAsyncHelper.debug                  = require('debug')('DenonAsyncHelper:debug');
DenonAsyncHelper.info                   = require('debug')('DenonAsyncHelper:info');
DenonAsyncHelper.warn                   = require('debug')('DenonAsyncHelper:warn');
DenonAsyncHelper.DenonMarantzTelnet     = require('marantz-denon-telnet')


DenonAsyncHelper.debug.color = 2;   // hack. On windows debug doesn't seem to work real well, and even tho supports-colors
                                    // detects 16m colours, debug insists on only using 6.
DenonAsyncHelper.info.color  = 2;
DenonAsyncHelper.warn.color  = 2;


// This isn't async... but it keeps the encapsulation fairly well
DenonAsyncHelper.GetClient = function(host)
{
    return new DenonAsyncHelper.DenonMarantzTelnet(host);
}
DenonAsyncHelper.GetPowerState = (client) => ({
        then(done) {
            client.getPowerState(function(error, data) {
                if(!error)
                {
                    DenonAsyncHelper.debug('Power state of AVR is: ' + (data ? 'ON' : 'STANDBY') + ' - ' + data);
                    done(data ? 'ON' : 'STANDBY');
                }
                else
                {
                    DenonAsyncHelper.debug('GetPowerState:Error when connecting to AVR: ' + error);
                    done(null);
                }
            });
        }
    });
DenonAsyncHelper.SetPowerState = (client, power_state) => ({
        then(done)
        {
            DenonAsyncHelper.debug('SetPowerState(%o)', power_state);

            client.setPowerState(power_state, function(error, data) {
                DenonAsyncHelper.debug('SetPowerState returned %o and %o', error, data);
                if(!error)
                {
                    DenonAsyncHelper.debug('AVR changed power state: ' + data);
                    DenonAsyncHelper.debug('PW: %o', data);
                    done(data);
                }
                else
                {
                    DenonAsyncHelper.debug('SetPowerState:Error when connecting to AVR: ' + error);
                    done(null);
                }
            });
        }
    });

DenonAsyncHelper.GetVolume = (client) => ({
        then(done) {
            client.getVolume(function(error, data) {
                if(!error)
                {
                    var val = data - 80;
                    DenonAsyncHelper.debug('Volume of AVR is: %o',val);
                    done(val);
                }
                else
                {
                    DenonAsyncHelper.debug('GetVolume:Error when connecting to AVR: %o',error);
                    done(null);
                }
            });
        }
    });
DenonAsyncHelper.SetVolume = (client, volume) => ({
        then(done)
        {
            var val = volume + 80;
            client.setVolume(val, function(error, data) {
                if(!error)
                {
                    DenonAsyncHelper.debug('AVR changed volume: %o', data);
                    done(data);
                }
                else
                {
                    DenonAsyncHelper.debug('SetVolume:Error when connecting to AVR: ' + error);
                    done(null);
                }
            });
        }
    });
DenonAsyncHelper.GetMuteState = (client) => ({
        then(done) {
            client.getMuteState(function(error, data) {
                if(!error)
                {
                    DenonAsyncHelper.debug('AVR has mute state: ' + data);
                    done(data);
                }
                else
                {
                    DenonAsyncHelper.debug('GetMuteState:Error when connecting to AVR: ' + error);
                    done(null);
                }
            });
        }
    });
DenonAsyncHelper.SetMuteState = (client, mute_state) => ({
        then(done)
        {
            client.setMuteState(mute_state, function(error, data) {
                if(!error)
                {
                    DenonAsyncHelper.debug('AVR set mute state: %o', data);
                    done(data);
                }
                else
                {
                    DenonAsyncHelper.debug('SetMuteState:Error when connecting to AVR: ' + error);
                    done(null);
                }
            });
        }
    });
DenonAsyncHelper.GetInput = (client) => ({
        then(done) {
            client.getInput(function(error, data) {
                if(!error)
                {
                    DenonAsyncHelper.debug('AVR has input: %o', data['SI']);
                    done(data['SI']);
                }
                else
                {
                    DenonAsyncHelper.debug('GetInput:Error when connecting to AVR: ' + error);
                    done(null);
                }
            });
        }
    });
DenonAsyncHelper.SetInput = (client, input) => ( {
    then(done) {
        DenonAsyncHelper.debug("SetInput(%o)", input);
        client.setInput(input, function(error, data) {
            if(!error)
            {
                DenonAsyncHelper.debug('AVR changed input: %o', data);
                done(data);
            }
            else
            {
                DenonAsyncHelper.debug('SetInput:Error when connecting to AVR: ' + error);
                done(null);
            }
        });
    }});

// Having all the individual helpers is all well and good, but we want to collect
// all the state in one shot, in as short a time period as possible, and by breaking it up
// we force a tear down and reconnect each time.
// The underlying denon telnet library has a queue, so we can just fire all at once.
DenonAsyncHelper.UpdateState = async function(client)
{
    DenonAsyncHelper.info("UpdateState");
    let state = null;
    if(!client)
    {
        DenonAsyncHelper.warn("No connection to AVR");
        return null;
    }

    const getPowerStateTask     = DenonAsyncHelper.GetPowerState(client);
    const getVolumeTask         = DenonAsyncHelper.GetVolume(client);
    const getMuteStateTask      = DenonAsyncHelper.GetMuteState(client);
    const getInputTask          = DenonAsyncHelper.GetInput(client);

    let power   = await getPowerStateTask;
    if (power === null)
    {
        // First check failed, possibly a connection error. Bailing out.
        DenonAsyncHelper.warn("failed to get power");
        return false;
    }
    let volume  = await getVolumeTask;
    if (volume === null)
    {
        // First check failed, possibly a connection error. Bailing out.
        DenonAsyncHelper.warn("failed to get power");
        return false;
    }
    let mute    = await getMuteStateTask;
    if (mute === null)
    {
        // First check failed, possibly a connection error. Bailing out.
        DenonAsyncHelper.warn("failed to get mute");
        return false;
    }
    let input   = await getInputTask;
    if (input === null)
    {
        // First check failed, possibly a connection error. Bailing out.
        DenonAsyncHelper.warn("failed to get input");
        return false;
    }

    state                            = {};
    state.volume_state               = {};
    state.volume_state.volume_value  = volume;
    state.volume_state.is_muted      = mute;
    state.source_state               = {};
    state.source_state.power         = power;
    state.source_state.input         = input;

    DenonAsyncHelper.info("Got state: %o", state);
    return state;
}

DenonAsyncHelper.UpdateStateOld = async function(client)
{
    DenonAsyncHelper.info("UpdateState");
    let state = null;
    if(!client)
    {
        DenonAsyncHelper.warn("No connection to AVR");
        return null;
    }


    let power   = await DenonAsyncHelper.GetPowerState(client);
    if (power === null)
    {
        // First check failed, possibly a connection error. Bailing out.
        DenonAsyncHelper.warn("failed to get power");
        return false;
    }
    let volume  = await DenonAsyncHelper.GetVolume(client);
    if (volume === null)
    {
        // First check failed, possibly a connection error. Bailing out.
        DenonAsyncHelper.warn("failed to get power");
        return false;
    }
    let mute    = await DenonAsyncHelper.GetMuteState(client);
    let input   = await DenonAsyncHelper.GetInput(client);

    state                            = {};
    state.volume_state               = {};
    state.volume_state.volume_value  = volume;
    state.volume_state.is_muted      = mute;
    state.source_state               = {};
    state.source_state.power         = power;
    state.source_state.input         = input;

    DenonAsyncHelper.info("Got state: %o", state);
    return state;
}

Object.freeze(DenonAsyncHelper);

module.exports = DenonAsyncHelper;
