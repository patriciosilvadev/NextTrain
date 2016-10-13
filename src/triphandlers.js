'use strict';

const log = require('./log');
const ld = require('lodash');
const fb = require('thefacebook');
const OTPlanner = require('./OTPlanner');
const moment = require('moment-timezone');
const compressAndStorePlan = require('./otputil').compressAndStorePlan;
const TODAY = moment().tz('America/New_York');
const fuzzy = require('fuzzy-filter');

class TripRequestHandler {
    constructor(job, type) {
        this.job    = job;
        this.type   = type;
        this.log    = log.child({ requestType : this.type, user : this.job.user.userId });

        let currentHandlerType = ld.get(this,'job.user.data.currentRequest.type');
        if (currentHandlerType !== type) {
            this.user.data.currentRequest = {};
        }

        this.log.trace('Initialized.');
    }

    send(msg) {
        return this.message.send( this.job.user.userId, msg, this.job.token);
    }

    get noob() {
        return (ld.get(this,'user.data.tripHistory.length',0) <= 3);
    }

    get message() {
        if (!this._message) {
            this._message = new fb.Message();
        }
        return this._message;
    }

    get otp() {
        if (!this._otp) {
            this._otp = new OTPlanner(this.job.app.otp);
        }
        return this._otp;
    }
    
    get shouldSendTripsWide() {
        return ld.get(this,'job.app.stageVars.sendTripsWide',false);
    }

    get shouldRequestStationSelectionWide() {
        return ld.get(this,'job.app.stageVars.requestStationSelectionWide',false);
    }

    get numItineraries() {
        return ld.get(this,'job.app.stageVars.numItineraries',3);
    }

    get request() {
        return ld.get(this,'job.user.data.currentRequest');
    }

    get payload() {
        return ld.get(this,'job.payload');
    }

    set state(state) {
        ld.get(this,'job.user.data.currentRequest').state = state;
    }
    
    get state() {
        return ld.get(this,'job.user.data.currentRequest.state');
    }

    get user() {
        return ld.get(this,'job.user');
    }

    abbrevStopName(stopName) {
        this.log.debug(`abbrevStopName: ${stopName}`);
        const replaces = {
            STREET : 'ST',
            'LIGHT RAIL': 'LR',
            LIGHT : 'LT',
            LEVEL : 'LVL',
            RAILROAD : 'RR',
            RAIL : 'RL',
            ROUTE : 'RT',
            DRIVE : 'DR',
            AVENUE : 'AV',
            TERMINAL : 'TERM',
            STATION : 'STN',
            DEPARTURE : 'DEP',
            TRANSIT: 'TRANS',
            CENTER : 'CTR',
            'FRANK R LAUTENBERG' : ''
        };
        
        if (stopName.length <= 18) {
            return stopName;
        }

        let newName = stopName;
        for (let repl in replaces) {
            newName = newName.replace(repl,replaces[repl]);
            if (newName.length < 18) {
                break;
            }
        }

        if (newName.length > 20) {
            newName = newName.substr(0,18) + '..';
        }

        return newName;
    }

    requestStop(prompt) {
        this.log.debug('exec requestStop');
        let text = new fb.Text(prompt);
        text.quick_replies.push(new fb.LocationQuickReply() );
        
        let checkName = (this.state === 'WAIT_ORIGIN') ?
            ld.get(this,'request.data.destination') :
            ld.get(this,'request.data.origin');
        let checkId = (this.state === 'WAIT_ORIGIN') ?
            ld.get(this,'request.data.destinationStop.id') :
            ld.get(this,'request.data.originStop.id');

        let stopped = {};
        for (let trip of ld.get(this,'user.data.tripHistory',[])){
            for (let stop of [ trip.data.destinationStop, trip.data.originStop ]) {
                this.log.debug({ stop : stop }, 'EVAL HISTORICAL STOP');
                if (( text.quick_replies.length < 10) && 
                    (stopped[stop.name] === undefined) && 
                    (checkId !== stop.id) && 
                    ((!checkName) || (fuzzy(checkName,[stop.name], { limit : 1}).length === 0))
                    ) {
                    stopped[stop.name] = true;
                    this.log.debug({ stop : stop }, 'ADD STOP BUTTON');
                    text.quick_replies.push(new fb.TextQuickReply( { 
                        title: this.abbrevStopName(stop.name),
                        payload: JSON.stringify({ type: 'stop', stop: stop })
                    }));
                }
            }
        }

        return this.send(text);
    }
    
//    requestStop(prompt) {
//        let trip = ld.get(this,'user.data.tripHistory[0]');
//        let text = new fb.Text(prompt);
//        text.quick_replies.push(new fb.LocationQuickReply() );
//        log.debug({ thisTrip : this.request, oldTrip : trip}, 'REQUEST STOP QR CHECK');
//        
//        if (trip) {
//            let re, newId;
//            
//            // If we are looking for an Origin, make sure the old trip does not
//            // match this trip's destination as we do not want to suggest a possible
//            // destination match for the origin.
//            // If we are looking for a Destination, then make sure we don't suggest
//            // something we've already used for the origin.
//            
//            if (this.state === 'WAIT_ORIGIN') {
//                re = new RegExp(ld.get(this,'request.data.destination',''),'gi');
//                newId = ld.get(this,'request.data.destinationStop.id','');
//            } else {
//                re = new RegExp(ld.get(this,'request.data.origin',''),'gi');
//                newId = ld.get(this,'request.data.originStop.id','');
//            }
//
//            [trip.data.destinationStop, trip.data.originStop].forEach( (oldStop) => {
//                if ((!oldStop.name.match(re)) && (oldStop.id !== newId)) {
//                    text.quick_replies.push(new fb.TextQuickReply( { 
//                        title: this.abbrevStopName(oldStop.name),
//                        payload: JSON.stringify({ type: 'stop', stop: oldStop })
//                    }));
//                }
//
//            });
//        }
//        
//        return this.send(text);
//    }
    
    requestOrigin() {
        this.log.debug('exec requestOrigin');
        this.state = 'WAIT_ORIGIN';
        return this.requestStop(this.getRequestOriginText());
    }
    
    requestDestination() {
        this.log.debug('exec requestDestination');
        this.state = 'WAIT_DESTINATION';
        return this.requestStop(this.getRequestDestinationText());
    }
    
    displayDate(dt) {
        let m = moment(dt).tz('America/New_York');
        let format = 'ddd, h:mmA';

        if (m.isSame(TODAY,'day')) {
            format = 'h:mmA';
        }

        return moment(dt).tz('America/New_York').format(format);
    }
   
    
    //Optional alternative for formatting station choices
    
    requestStationSelectionWide (stations) {
        this.log.debug({ stops : stations}, 'exec requestStationSelectionWide');
        let templ = new fb.GenericTemplate();
        let action = stations.length > 1 ? 'Select' : 'Confirm';
//        let stopType = this.state === 'WAIT_ORIGIN' ? 'Origin' : 'Destination';
        
        for (let station of stations) {
            let s3Bucket = `https://s3.amazonaws.com/${this.job.app.appId}`;
            let mapUrl = `https://www.google.com/maps?q=${station.lat}%2C${station.lon}`;
            let imgUrl = `${s3Bucket}/img/njtransit/rail/${station.code}.png`;
            let stopName = this.abbrevStopName(station.name);

            let payload = {
                type : 'stop',
                stop : station
            };

            let cfg = {
                title : stopName,
                item_url : mapUrl,
                image_url : imgUrl
            };

            if (station.dist) {
                let distance = Math.round((station.dist * 0.000621371) * 10) / 10;
                cfg.subtitle = `${distance} miles away`;
            }

            cfg.buttons = [
//                new fb.UrlButton({ title : 'Map', url : mapUrl }),
                new fb.PostbackButton({ title : action,
                    payload : JSON.stringify(payload) })
            ];

            this.log.debug({element : cfg }, 'create Element');
            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }

        return this.send(templ);
    }

    requestStationSelection(stations) {
        this.log.debug('exec requestStationSelection');
        if (this.shouldRequestStationSelectionWide) {
            return this.requestStationSelectionWide(stations);
        }
        let action = stations.length > 1 ? 'Select' : 'Confirm';
//        let stopType = this.state === 'WAIT_ORIGIN' ? 'Origin' : 'Destination';
        let templ = new fb.ButtonTemplate(action);

        templ.buttons = stations.map( (station) => {
            let payload = { type : 'stop', stop : station };
            let stopName = this.abbrevStopName(station.name);
            let title = stopName;
            if (station.dist) {
                let distance = Math.round((station.dist * 0.000621371) * 10) / 10;
                title = `${stopName} ${distance} m`;
            }
            return new fb.PostbackButton({ title : title, payload : JSON.stringify(payload) });
        });
       
        log.info(`Sending ${stations.length} stops to user.`);
        return this.send(templ);
    }
    
    getStationFromLocation(coordinates) {
        this.log.debug('exec getStationFromLocation');
        let otp = this.otp;
        let otpParams = {
            lat : coordinates.lat,
            lon : coordinates.long,
            radius : 10000
        };
        
        return otp.findStops(otpParams)
        .then((results) => {
            if (!results || !results.length) {
                return this.send('No local stations found, try typing one in.');
            }

            this.log.debug({ results : results }, 'OTP found stops');
            return this.requestStationSelection(results );
        })
        .catch((err) => {
            this.log.error('Error: %s', err.message);
            return this.send('No stations found, try typing one in.');
        });
    }

    getStationFromList(stationName ) {
        this.log.debug('exec getStationFromList');
        return this.otp.findStops()
        .then((results) => {
            if (!results || !results.length) {
                return this.send('No stations found, try again later.');
            }

            let matches = fuzzy(stationName, results.map((stop) => stop.name), { limit : 5 });
            //let re = new RegExp(stationName,'gi');
            //let matches = results.filter( stop => {
            //    return stop.name.match(re);
            //});
       
            this.log.debug({ 
                text: stationName,
                results : results.length, 
                matches : matches.length }, 'MATCH CHECK');

            if (!matches || !matches.length) {
                return this.send('No matching stations found, try again.');
            }

            if (matches.length > 5) {
                return this.send('Too many matching stations found, try again.');
            }

            let previousStops = {};
            for (let trip of ld.get(this,'user.data.tripHistory',[])) {
                previousStops[ld.get(trip,'data.destinationStop.name','unknown')] = true;
                previousStops[ld.get(trip,'data.originStop.name','unknown')] = true;
            }

            log.debug({previousStops : previousStops}, 'PREV STOPS');

            let matchStops = {};
            for (let match of matches) {
                matchStops[match] = true;
            }

            matches = results.filter( stop => matchStops[stop.name]).sort((a,b) => {
                if (previousStops[a.name]) {
                    return -1;
                } else
                if (previousStops[b.name]) {
                    return 1;
                } else {
                    return a > b ? 1 : -1;
                }
            });

            this.log.debug({ results : matches, resultType: typeof(matches) }, 
                'OTP found stops');
            return this.requestStationSelection(matches );
        })
        .catch((err) => {
            this.log.error('Error: %s', err.message);
            return this.send('No stations found, try typing one in.');
        });
    }
    
    work() {
        let state = ld.get(this, 'job.user.data.currentRequest.state','NEW');
        let doWork = () => {
            this.log.info(`doWork for state ${state}`);
            if (state === 'NEW') {
                return this.onNew();
            }
            else
            if (state === 'WAIT_ORIGIN') {
                return this.onWaitOrigin();
            } 
            else
            if (state === 'WAIT_DESTINATION') {
                return this.onWaitDestination();
            } 
            else
            if (state === 'READY') {
                return this.onReady();
            } 

            return Promise.resolve({});
        };
        return doWork().then(() => this.job );
    }

    onNew() {
        this.log.debug('exec onNew');
        let rqs = { type : this.type, state : 'NEW' };
        rqs.data = this.payload;
        this.user.data.currentRequest = rqs;
        return this.evalState();
    }
    
    onWaitOrigin() {
        this.log.debug('exec onWaitOrigin, job.payloadType=%s',this.job.payloadType);
        if (this.job.payloadType === 'location') {
            return this.getStationFromLocation(this.payload.coordinates);
        } else
        if (this.job.payloadType === 'text') {
            this.request.data.origin = this.job.msg.message.text;
            return this.getStationFromList(this.request.data.origin);
        } else 
        if (this.job.payloadType === 'postback') {
            if (this.payload.type === 'stop') {
                this.request.data.originStop = this.payload.stop;
                if (!this.request.data.origin) {
                    this.request.data.origin = this.payload.stop.name;
                }
                return this.evalState();
            }
        }
        
        return Promise.resolve(this.job);
    }

    onWaitDestination() {
        if (this.job.payloadType === 'location') {
            return this.getStationFromLocation(this.payload.coordinates);
        } else
        if (this.job.payloadType === 'text') {
            this.request.data.destination = this.job.msg.message.text;
            return this.getStationFromList(this.request.data.destination);
        } else 
        if (this.job.payloadType === 'postback') {
            if (this.payload.type === 'stop') {
                this.request.data.destinationStop = this.payload.stop;
                if (!this.request.data.destination) {
                    this.request.data.destination = this.payload.stop.name;
                }
                return this.evalState();
            }
        }
        
        return Promise.resolve(this.job);
    }

    finishRequest() {
        this.job.done = true;
        this.state = 'DONE';
        let history = this.user.data.tripHistory || [];
        history.unshift(this.request);
        while (history.length > 5) {
            history.pop();
        }
        this.user.data.tripHistory = history;
        return this;
    }

}

class DepartingTripRequestHandler extends TripRequestHandler {
    constructor(job) {
        super(job,'schedule_departing');
    }

    evalState() {
        this.log.debug('exec evalState');
        let rqs = this.request;
        
        if (!rqs.data.origin) {
            // If they typed in a destination, lets make sure its valid before
            // we ask them for an origin.
            if ((rqs.data.destination) && (!rqs.data.destinationStop)){
                this.state = 'WAIT_DESTINATION';
                return this.getStationFromList(
                    this.request.data.destination, 'Select Destination');
            } 
            return this.requestOrigin();
        }
        else
        if (!rqs.data.originStop) {
            this.state = 'WAIT_ORIGIN';
            return this.getStationFromList(this.request.data.origin, 'Select Origin');
        }
        else
        if (!rqs.data.destination) {
            return this.requestDestination();
        }
        else
        if (!rqs.data.destinationStop) {
            this.state = 'WAIT_DESTINATION';
            return this.getStationFromList(this.request.data.destination, 'Select Destination');
        }
        else {
            this.state = 'READY';
            return this.work();
        }
    }

    
    getRequestOriginText() {
        let text = 'Departing where?';
        if (this.noob) {
            text += ' Type the name of the station, or hit Send Location and ' +
                'I\'ll try to find a station nearby.';
        }
        return text;
    }
    
    getRequestDestinationText() {
        let text = 'What\'s the destination?';
        if (this.noob) {
            text += ' Type the name of the station, or hit Send Location and ' +
                'I\'ll try to find a station nearby.';
        }
        this.state = 'WAIT_DESTINATION';
        return text;
    }
    
    sendTripsWide (plans ) {
        this.log.debug('exec sendTrips');
        let templ = new fb.GenericTemplate();

        for (let plan of plans) {
            let i = plan.itinerary;
            let link = `${this.job.app.appRootUrl}/tripview?i=${plan.itineraryId}`;
            this.log.debug(`trip link: ${link}`);
            let cfg = {
                title : `Departs ${this.abbrevStopName(i.from)} - ` +
                    this.displayDate(i.startTime),
                subtitle : `Arrives ${this.abbrevStopName(i.to)} - ` +
                    `${this.displayDate(i.endTime)}. Trip time is ` +
                    moment(i.endTime).diff(moment(i.startTime), 'minutes') + ' minutes'
            };

            cfg.buttons = [
                new fb.UrlButton({ title : 'View', url : link }),
                new fb.ShareButton()
            ];

            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }
        
        if (templ.elements.length < 1 ) {
            return this.send('Sorry, but I wasn\'t able to find any trips. Try starting over?');
        }

        return this.send(templ);
    }
    
    sendTrips (plans ) {
        this.log.debug('exec sendTrips');
        if (this.shouldSendTripsWide) {
            return this.sendTripsWide(plans);
        }
        let templ = new fb.ButtonTemplate('Departing at');

        for (let plan of plans) {
            let i = plan.itinerary;
            let link = `${this.job.app.appRootUrl}/tripview?i=${plan.itineraryId}`;
            let startTime = this.displayDate(i.startTime);
            let tripTime = moment(i.endTime).diff(moment(i.startTime), 'minutes') + ' minutes';
            let cfg = { title : `${startTime} - ${tripTime}`, url : link };

            this.log.info({trip: cfg}, 'SEND TRIP');
            templ.buttons.push(new fb.UrlButton(cfg));
        }
        
        if (templ.buttons.length < 1 ) {
            return this.send('Sorry, but I wasn\'t able to find any trips. Try starting over?');
        }
        
        return this.send(templ);
    }
    

    onReady() {
        let otp = this.otp;
        let params = {
            fromPlace : this.request.data.originStop.id,
            toPlace: this.request.data.destinationStop.id,
            mode : 'TRANSIT',
            maxWalkDistance:804.672,
            locale:'en',
            numItineraries : this.numItineraries,
            showIntermediateStops: true
        };

        this.log.debug({ otpParams : params }, 'calling findPlans');
        return otp.findPlans(params)
        .then(plans  => compressAndStorePlan(this.job.app.appId, plans) )
        .then(compressedPlans => this.sendTrips(compressedPlans) )
        .then(() => this.finishRequest() );
    }
}

class ArrivingTripRequestHandler extends TripRequestHandler {
    constructor(job) {
        super(job,'schedule_arriving');
    }
    
    getRequestOriginText() {
        let text = 'Coming from which station?';
        if (this.noob) {
            text += 'Type the name of the station, or hit Send Location and ' +
                'I\'ll try to find a station nearby.';
        }
        return text;
    }
    
    getRequestDestinationText() {
        let text = 'Arriving where?';
        if (this.noob) {
            text += 'Type the name of the station, or hit Send Location and ' +
                'I\'ll try to find a station nearby.';
        }
        this.state = 'WAIT_DESTINATION';
        return text;
    }
    
    evalState() {
        this.log.debug('exec evalState');
        let rqs = this.request;
        
        if (!rqs.data.destination) {
            return this.requestDestination();
        }
        else
        if (!rqs.data.destinationStop) {
            this.state = 'WAIT_DESTINATION';
            return this.getStationFromList(this.request.data.destination, 'Select Destination');
        }
        else 
        if (!rqs.data.origin) {
            // If they typed in a destination, lets make sure its valid before
            // we ask them for an origin.
            if ((rqs.data.destination) && (!rqs.data.destinationStop)){
                this.state = 'WAIT_DESTINATION';
                return this.getStationFromList(
                    this.request.data.destination, 'Select Destination');
            } 
            return this.requestOrigin();
        }
        else
        if (!rqs.data.originStop) {
            this.state = 'WAIT_ORIGIN';
            return this.getStationFromList(this.request.data.origin, 'Select Origin');
        }
        else {
            this.state = 'READY';
            return this.work();
        }
    }

    
    sendTrips (plans ) {
        this.log.debug('exec sendTrips');
        if (this.shouldSendTripsWide) {
            return this.sendTripsWide(plans);
        }

        let templ = new fb.ButtonTemplate('Arriving in');
        let now = moment().tz('America/New_York');

        plans = (plans || []).sort((a,b) => ( a.itinerary.endTime > b.itinerary.endTime ));
        for (let plan of plans) {
            this.log.debug({ plan : plan}, 'HANDLE PLAN');
            let i = plan.itinerary;
            let endTime = this.displayDate(i.endTime);
            
            if (moment(i.endTime).tz('America/New_York').isBefore(now)) {
                this.log.debug(`trip has endTime (${endTime}) < now, skip`);
                continue;
            }
            
            let link = `${this.job.app.appRootUrl}/tripview?i=${plan.itineraryId}`;
            let arrivesIn = moment(i.endTime).tz('America/New_York').fromNow(true);
            
            let cfg = { title : `${arrivesIn} - ${endTime}`, url : link };

            this.log.info({trip: cfg}, 'SEND TRIP');
            templ.buttons.push(new fb.UrlButton(cfg));
        }

        if (templ.buttons.length < 1 ) {
            return this.send('Sorry, but I wasn\'t able to find any trips. Try starting over?');
        }
        
        return this.send(templ);
    }
    
    
    sendTripsWide (plans ) {
        this.log.debug('exec sendTripsWide');
        let templ = new fb.GenericTemplate();
        let now = moment().tz('America/New_York');

        plans = (plans || []).sort((a,b) => ( a.itinerary.endTime > b.itinerary.endTime ));
        for (let plan of plans) {
            let i = plan.itinerary;
            let endTime = this.displayDate(i.endTime);

            if (moment(i.endTime).tz('America/New_York').isBefore(now)) {
                this.log.debug(`trip has endTime (${endTime}) < now, skip`);
                continue;
            }

            //let arrivesIn = moment(i.endTime).tz('America/New_York').fromNow(true);
            let link = `${this.job.app.appRootUrl}/tripview?i=${plan.itineraryId}`;
            let cfg = {
                title : `Arrives ${this.abbrevStopName(i.to)} - ${endTime}`
//                title : `Scheduled to arrive in ${arrivesIn} (${this.displayDate(i.endTime)})`
            };

            cfg.buttons = [
                new fb.UrlButton({ title : 'View', url : link }),
                new fb.ShareButton()
            ];

            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }

        log.debug(`checking elements length: ${templ.elements.length}`);
        if (templ.elements.length < 1 ) {
            return this.send('Sorry, but I wasn\'t able to find any trips. Try starting over?');
        }
        
        return this.send(templ);
    }


    onReady() {
        let otp = this.otp;
        let range = moment().tz('America/New_York').add(1,'hours');
        let params = {
            fromPlace : this.request.data.originStop.id,
            toPlace: this.request.data.destinationStop.id,
            mode : 'TRANSIT',
            maxWalkDistance:804.672,
            locale:'en',
            numItineraries : this.numItineraries,
            showIntermediateStops: true,
            arriveBy : true,
            date : range.format('MM-DD-YYYY'),
            time : range.format('HH:mm:00')
        };

        this.log.debug({ otpParams : params }, 'calling findPlans');
        return otp.findPlans(params)
        .then(plans  => compressAndStorePlan(this.job.app.appId, plans) )
        .then(compressedPlans => this.sendTrips(compressedPlans) )
        .then(() => this.finishRequest() );
    }
}

exports.DepartingTripRequestHandler = DepartingTripRequestHandler;
exports.ArrivingTripRequestHandler = ArrivingTripRequestHandler;