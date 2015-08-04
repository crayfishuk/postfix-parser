'use strict';

if (process.env.COVERAGE) require('blanket');

var envEmailAddr   = '<([^>]*)>';
var postfixQid     = '[0-9A-F]{10,11}';     // default queue ids
var postfixQidLong = '[0-9A-Za-z]{14,16}';  // optional 'long' ids
var postfixQidAny  = postfixQidLong + '|' + postfixQid;

/* jshint maxlen: 90 */
var regex = {
    syslog: /^([A-Za-z]{3} [0-9 ]{2} [\d:]{8}) ([^\s]+) ([^\[]+)\[([\d]+)\]: (.*)$/,
    smtp : new RegExp(
            '^(?:(' + postfixQidAny + '): )?' +
            '(to)=' + envEmailAddr + ', ' +
            '(?:(orig_to)=' + envEmailAddr + ', )?' +
            '(relay)=([^,]+), ' +
            '(?:(conn_use)=([0-9]+), )?' +
            '(delay)=([^,]+), ' +
            '(delays)=([^,]+), ' +
            '(dsn)=([^,]+), ' +
            '(status)=(.*)$'
        ),
    'smtp-conn-err': /^connect to ([^\s]+): (.*)$/,
    'smtp-debug': new RegExp(
            '(?:(' + postfixQidAny + '): )?' +
            '(enabling PIX workarounds|' +
            'Cannot start TLS: handshake failure|lost connection with .*|' +
            '^SSL_connect error to .*|^warning: no MX host for |' +
            '^warning: TLS library problem:|^warning: numeric domain name|' +
            ': conversation with |: host )'),
    qmgr : new RegExp(
            '^(?:(' + postfixQidAny + '): )?' +
            '(from)=' + envEmailAddr + ', ' +
            '(?:' +
            '(size)=([0-9]+), ' +
            '(nrcpt)=([0-9]+) ' +
            '|' +
            '(status)=(.*)$' +
            ')'
        ),
    'qmgr-removed': new RegExp('^(' + postfixQidAny + '): removed'),
    cleanup : new RegExp(
            '^(?:(' + postfixQidAny + '): )?' +
            '((?:resent-)?message-id)=' + envEmailAddr 
        ),
    pickup : new RegExp(
            '^(?:(' + postfixQidAny + '): )?' +
            '(uid)=([0-9]+) ' +
            '(from)=' + envEmailAddr
        ),
    'error' : new RegExp(
            '^(?:(' + postfixQidAny + '): )?' +
            '(to)=' + envEmailAddr + ', ' +
            '(?:(orig_to)=' + envEmailAddr + ', )?' +
            '(relay)=([^,]+), ' +
            '(delay)=([^,]+), ' +
            '(delays)=([^,]+), ' +
            '(dsn)=([^,]+), ' +
            '(status)=(.*)$'
        ),
    bounce : new RegExp(
            '^(?:(' + postfixQidAny + '): )?' +
            'sender non-delivery notification: ' +
            '(' + postfixQidAny + '$)'
        ),
    local : new RegExp(
            '^(?:(' + postfixQidAny + '): )?' +
            '(to)=' + envEmailAddr + ', ' +
            '(relay)=([^,]+), ' +
            '(delay)=([^,]+), ' +
            '(delays)=([^,]+), ' +
            '(dsn)=([^,]+), ' +
            '(status)=sent ' +
            '\\((forwarded) (as) ' +
            '(' + postfixQidAny + ')' +
            '\\)$'
        ),
    scache : new RegExp('^statistics: (.*)'),
    postscreen : new RegExp('^(.*)'),
};

exports.asObject = function (line) {

    var match = line.match(regex.syslog);
    if (!match) {
        console.error('unparsable syslog: ' + line);
        return;
    }

    var syslog = syslogAsObject(match);
    if (!/^postfix/.test(syslog.prog)) return; // not postfix, ignore

    var parsed = exports.asObjectType(syslog.prog, syslog.msg);
    if (!parsed) {
        console.error('unparsable ' + syslog.prog + ': ' + syslog.msg);
        return;
    }

    ['date','host','prog','pid'].forEach(function (f) {
        if (!syslog[f]) return;
        parsed[f] = syslog[f];
    });

    return parsed;
};

exports.asObjectType = function (type, line) {
    /* jshint maxstatements: 25 */
    if (!type || !line) {
        console.error('missing required arg');
        return;
    }
    if ('postfix/' === type.substr(0,8)) type = type.substr(8);
    if (type === 'qmgr') return qmgrAsObject(line);
    if (type === 'smtp') return smtpAsObject(line);

    var match = line.match(regex[type]);
    if (!match) return;

    if (type === 'syslog') return syslogAsObject(match);
    if (type === 'bounce') return bounceAsObject(match);
    if (type === 'scache') return { statistics: match[1] };
    if (type === 'postscreen') return { postscreen: match[1] };
    match.shift();
    var obj = {};
    var qid = match.shift();
    if (qid) obj.qid = qid;
    while (match.length) {
        var key = match.shift();
        var val = match.shift();
        if (type === 'local' && key === 'as') key = 'forwardedAs';
        if (key && val) obj[key] = val;
    }
    return obj;
};

function syslogAsObject (match) {
    return {
        date: match[1],
        host: match[2],
        prog: match[3],
        pid : match[4],
        msg:  match[5],
    };
}

function matchAsObject (match) {
    var obj = {};
    var qid = match.shift();
    if (qid) obj.qid = qid;
    while (match.length) {
        var key = match.shift();
        var val = match.shift();
        if (key && val) obj[key] = val;
    }
    return obj;
}

function smtpAsObject (line) {
    var match = line.match(regex.smtp);
    if (match) {
        match.shift();
        return matchAsObject(match);
    }

    match = line.match(regex['smtp-conn-err']);
    if (match) return {
        action: 'delivery',
        mx: match[1],
        err: match[2]
    };

    match = line.match(regex['smtp-debug']);
    if (!match) return;
    if (match[1] && match[2]) return {
        qid: match[1],
        debug: match[2],
    };
    return { debug: match[0] };
}

function bounceAsObject (match) {
    match.shift();
    var obj = {};
    var qid = match.shift();
    if (qid) obj.qid = qid;
    obj.dsnQid = match.shift();
    return obj;
}

function qmgrAsObject (line) {
    var match = line.match(regex.qmgr);
    if (match) {
        match.shift();
        return matchAsObject(match);
    }

    match = line.match(regex['qmgr-removed']);
    if (match) return { qid: match[1], action: 'removed' };
}
