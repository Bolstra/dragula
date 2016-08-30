(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.dragula = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var cache = {};
var start = '(?:^|\\s)';
var end = '(?:\\s|$)';

function lookupClass (className) {
  var cached = cache[className];
  if (cached) {
    cached.lastIndex = 0;
  } else {
    cache[className] = cached = new RegExp(start + className + end, 'g');
  }
  return cached;
}

function addClass (el, className) {
  var current = el.className;
  if (!current.length) {
    el.className = className;
  } else if (!lookupClass(className).test(current)) {
    el.className += ' ' + className;
  }
}

function rmClass (el, className) {
  el.className = el.className.replace(lookupClass(className), ' ').trim();
}

module.exports = {
  add: addClass,
  rm: rmClass
};

},{}],2:[function(require,module,exports){
(function (global){
'use strict';

var emitter = require('contra/emitter');
var crossvent = require('crossvent');
var fastdom = require('fastdom');
var fastdomPromised = require('fastdom/extensions/fastdom-promised');
var classes = require('./classes');
var doc = document;
var documentElement = doc.documentElement;

function dragula(initialContainers, options) {
	var len = arguments.length;
	if (len === 1 && Array.isArray(initialContainers) === false) {
		options = initialContainers;
		initialContainers = [];
	}
	var _mirror; // mirror image
	var _source; // source container
	var _item; // item being dragged
	var _offsetX; // reference x
	var _offsetY; // reference y
	var _moveX; // reference move x
	var _moveY; // reference move y
	var _initialSibling; // reference sibling when grabbed
	var _currentSibling; // reference sibling now
	var _copy; // item used for copying
	var _renderTimer; // timer for setTimeout renderMirrorImage
	var _lastDropTarget = null; // last container item was over
	var _grabbed; // holds mousedown context until first mousemove

	var o = options || {};
	if (o.moves === void 0) {
		o.moves = always;
	}
	if (o.accepts === void 0) {
		o.accepts = always;
	}
	if (o.invalid === void 0) {
		o.invalid = invalidTarget;
	}
	if (o.containers === void 0) {
		o.containers = initialContainers || [];
	}
	if (o.isContainer === void 0) {
		o.isContainer = never;
	}
	if (o.copy === void 0) {
		o.copy = false;
	}
	if (o.copySortSource === void 0) {
		o.copySortSource = false;
	}
	if (o.revertOnSpill === void 0) {
		o.revertOnSpill = false;
	}
	if (o.removeOnSpill === void 0) {
		o.removeOnSpill = false;
	}
	if (o.direction === void 0) {
		o.direction = 'vertical';
	}
	if (o.ignoreInputTextSelection === void 0) {
		o.ignoreInputTextSelection = true;
	}
	if (o.mirrorContainer === void 0) {
		o.mirrorContainer = doc.body;
	}

	var drake = emitter({
		containers: o.containers,
		start: manualStart,
		end: end,
		cancel: cancel,
		remove: remove,
		destroy: destroy,
		canMove: canMove,
		dragging: false
	});

	if (o.removeOnSpill === true) {
		drake.on('over', spillOver).on('out', spillOut);
	}

	events();

	return drake;

	function isContainer(el) {
		return drake.containers.indexOf(el) !== -1 || o.isContainer(el);
	}

	function events(remove) {
		var op = remove ? 'remove' : 'add';
		touchy(documentElement, op, 'mousedown', grab);
		touchy(documentElement, op, 'mouseup', release);
	}

	function eventualMovements(remove) {
		var op = remove ? 'remove' : 'add';
		touchy(documentElement, op, 'mousemove', startBecauseMouseMoved);
	}

	function movements(remove) {
		var op = remove ? 'remove' : 'add';
		crossvent[op](documentElement, 'selectstart', preventGrabbed); // IE8
		crossvent[op](documentElement, 'click', preventGrabbed);
	}

	function destroy() {
		events(true);
		release({});
	}

	function preventGrabbed(e) {
		if (_grabbed) {
			e.preventDefault();
		}
	}

	function grab(e) {
		_moveX = e.clientX;
		_moveY = e.clientY;

		var ignore = whichMouseButton(e) !== 1 || e.metaKey || e.ctrlKey;
		if (ignore) {
			return; // we only care about honest-to-god left clicks and touch events
		}
		var item = e.target;
		var context = canStart(item);
		if (!context) {
			return;
		}
		_grabbed = context;
		eventualMovements();
		if (e.type === 'mousedown') {
			if (isInput(item)) { // see also: https://github.com/bevacqua/dragula/issues/208
				item.focus(); // fixes https://github.com/bevacqua/dragula/issues/176
			} else {
				e.preventDefault(); // fixes https://github.com/bevacqua/dragula/issues/155
			}
		}
	}

	function startBecauseMouseMoved(e) {
		if (!_grabbed) {
			return;
		}
		if (whichMouseButton(e) === 0) {
			release({});
			return; // when text is selected on an input and then dragged, mouseup doesn't fire. this is our only hope
		}
		// truthy check fixes #239, equality fixes #207
		if (e.clientX !== void 0 && e.clientX === _moveX && e.clientY !== void 0 && e.clientY === _moveY) {
			return;
		}
		if (o.ignoreInputTextSelection) {
			var clientX = getCoord('clientX', e);
			var clientY = getCoord('clientY', e);
			var elementBehindCursor = doc.elementFromPoint(clientX, clientY);
			if (isInput(elementBehindCursor)) {
				return;
			}
		}

		var grabbed = _grabbed; // call to end() unsets _grabbed
		eventualMovements(true);
		movements();
		end();
		start(grabbed);

		var offset = getOffset(_item);
		_offsetX = getCoord('pageX', e) - offset.left;
		_offsetY = getCoord('pageY', e) - offset.top;

		classes.add(_copy || _item, 'gu-transit');
		renderMirrorImage();
		drag(e);
	}

	function canStart(item) {
		if (drake.dragging && _mirror) {
			return;
		}
		if (isContainer(item)) {
			return; // don't drag container itself
		}
		var handle = item;
		while (getParent(item) && isContainer(getParent(item)) === false) {
			if (o.invalid(item, handle)) {
				return;
			}
			item = getParent(item); // drag target should be a top element
			if (!item) {
				return;
			}
		}
		var source = getParent(item);
		if (!source) {
			return;
		}
		if (o.invalid(item, handle)) {
			return;
		}

		var movable = o.moves(item, source, handle, nextEl(item));
		if (!movable) {
			return;
		}

		return {
			item: item,
			source: source
		};
	}

	function canMove(item) {
		return !!canStart(item);
	}

	function manualStart(item) {
		var context = canStart(item);
		if (context) {
			start(context);
		}
	}

	function start(context) {
		if (isCopy(context.item, context.source)) {
			_copy = context.item.cloneNode(true);
			drake.emit('cloned', _copy, context.item, 'copy');
		}

		_source = context.source;
		_item = context.item;
		_initialSibling = _currentSibling = nextEl(context.item);

		drake.dragging = true;
		drake.emit('drag', _item, _source);
	}

	function invalidTarget() {
		return false;
	}

	function end() {
		if (!drake.dragging) {
			return;
		}
		var item = _copy || _item;
		drop(item, getParent(item));
	}

	function ungrab() {
		_grabbed = false;
		eventualMovements(true);
		movements(true);
	}

	function release(e) {
		ungrab();

		if (!drake.dragging) {
			return;
		}
		var item = _copy || _item;
		var clientX = getCoord('clientX', e);
		var clientY = getCoord('clientY', e);
		var elementBehindCursor = getElementBehindPoint(_mirror, clientX, clientY);
		var dropTarget = findDropTarget(elementBehindCursor, clientX, clientY);
		if (dropTarget && ((_copy && o.copySortSource) || (!_copy || dropTarget !== _source))) {
			drop(item, dropTarget);
		} else if (o.removeOnSpill) {
			remove();
		} else {
			cancel();
		}
	}

	function drop(item, target) {
		var parent = getParent(item);
		if (_copy && o.copySortSource && target === _source) {
			parent.removeChild(_item);
		}
		if (isInitialPlacement(target)) {
			drake.emit('cancel', item, _source, _source);
		} else {
			drake.emit('drop', item, target, _source, _currentSibling);
		}
		cleanup();
	}

	function remove() {
		if (!drake.dragging) {
			return;
		}
		var item = _copy || _item;
		var parent = getParent(item);
		if (parent) {
			parent.removeChild(item);
		}
		drake.emit(_copy ? 'cancel' : 'remove', item, parent, _source);
		cleanup();
	}

	function cancel(revert) {
		if (!drake.dragging) {
			return;
		}
		var reverts = arguments.length > 0 ? revert : o.revertOnSpill;
		var item = _copy || _item;
		var parent = getParent(item);
		var initial = isInitialPlacement(parent);
		if (initial === false && reverts) {
			if (_copy) {
				parent.removeChild(_copy);
			} else {
				_source.insertBefore(item, _initialSibling);
			}
		}
		if (initial || reverts) {
			drake.emit('cancel', item, _source, _source);
		} else {
			drake.emit('drop', item, parent, _source, _currentSibling);
		}
		cleanup();
	}

	function cleanup() {
		var item = _copy || _item;
		ungrab();
		removeMirrorImage();
		if (item) {
			classes.rm(item, 'gu-transit');
		}
		if (_renderTimer) {
			clearTimeout(_renderTimer);
		}
		drake.dragging = false;
		if (_lastDropTarget) {
			drake.emit('out', item, _lastDropTarget, _source);
		}
		drake.emit('dragend', item);
		_source = _item = _copy = _initialSibling = _currentSibling = _renderTimer = _lastDropTarget = null;
	}

	function isInitialPlacement(target, s) {
		var sibling;
		if (s !== void 0) {
			sibling = s;
		} else if (_mirror) {
			sibling = _currentSibling;
		} else {
			sibling = nextEl(_copy || _item);
		}
		return target === _source && sibling === _initialSibling;
	}

	function findDropTarget(elementBehindCursor, clientX, clientY) {
		var target = elementBehindCursor;
		while (target && !accepted()) {
			target = getParent(target);
		}
		return target;

		function accepted() {
			var droppable = isContainer(target);
			if (droppable === false) {
				return false;
			}

			var immediate = getImmediateChild(target, elementBehindCursor);
			var reference = getReference(target, immediate, clientX, clientY);
			var initial = isInitialPlacement(target, reference);
			if (initial) {
				return true; // should always be able to drop it right back where it was
			}
			return o.accepts(_item, target, _source, reference);
		}
	}

	function drag(e) {
		if (!_mirror) {
			return;
		}
		e.preventDefault();

		var clientX = getCoord('clientX', e);
		var clientY = getCoord('clientY', e);
		var x = clientX - _offsetX;
		var y = clientY - _offsetY;

		_mirror.style.left = x + 'px';
		_mirror.style.top = y + 'px';

		var item = _copy || _item;
		var elementBehindCursor = getElementBehindPoint(_mirror, clientX, clientY);
		var dropTarget = findDropTarget(elementBehindCursor, clientX, clientY);
		var changed = dropTarget !== null && dropTarget !== _lastDropTarget;
		if (changed || dropTarget === null) {
			out();
			_lastDropTarget = dropTarget;
			over();
		}
		var parent = getParent(item);
		if (dropTarget === _source && _copy && !o.copySortSource) {
			if (parent) {
				parent.removeChild(item);
			}
			return;
		}
		var reference;
		var immediate = getImmediateChild(dropTarget, elementBehindCursor);
		if (immediate !== null) {
			reference = getReference(dropTarget, immediate, clientX, clientY);
		} else if (o.revertOnSpill === true && !_copy) {
			reference = _initialSibling;
			dropTarget = _source;
		} else {
			if (_copy && parent) {
				parent.removeChild(item);
			}
			return;
		}
		if (
			(reference === null && changed) ||
			reference !== item &&
			reference !== nextEl(item)
		) {
			_currentSibling = reference;
			dropTarget.insertBefore(item, reference);
			drake.emit('shadow', item, dropTarget, _source);
		}

		function moved(type) {
			drake.emit(type, item, _lastDropTarget, _source);
		}

		function over() {
			if (changed) {
				moved('over');
			}
		}

		function out() {
			if (_lastDropTarget) {
				moved('out');
			}
		}
	}

	function spillOver(el) {
		classes.rm(el, 'gu-hide');
	}

	function spillOut(el) {
		if (drake.dragging) {
			classes.add(el, 'gu-hide');
		}
	}

	function renderMirrorImage() {
		if (_mirror) {
			return;
		}

		_mirror = _item.cloneNode(true);

		fastdom.measure(function () {
			var rect = _item.getBoundingClientRect();

			fastdom.mutate(function () {
				_mirror.style.width = getRectWidth(rect) + 'px';
				_mirror.style.height = getRectHeight(rect) + 'px';

				classes.rm(_mirror, 'gu-transit');
				classes.add(_mirror, 'gu-mirror');

				o.mirrorContainer.appendChild(_mirror);
				classes.add(o.mirrorContainer, 'gu-unselectable');
			}).then(function () {
				touchy(documentElement, 'add', 'mousemove', drag);
				drake.emit('cloned', _mirror, _item, 'mirror');
			});
		});
	}

	function removeMirrorImage() {
		if (_mirror) {
			classes.rm(o.mirrorContainer, 'gu-unselectable');
			touchy(documentElement, 'remove', 'mousemove', drag);
			getParent(_mirror).removeChild(_mirror);
			_mirror = null;
		}
	}

	function getImmediateChild(dropTarget, target) {
		var immediate = target;
		while (immediate !== dropTarget && getParent(immediate) !== dropTarget) {
			immediate = getParent(immediate);
		}
		if (immediate === documentElement) {
			return null;
		}
		return immediate;
	}

	function getReference(dropTarget, target, x, y) {
		var horizontal = o.direction === 'horizontal';
		var reference = target !== dropTarget ? inside() : outside();
		return reference;

		function outside() { // slower, but able to figure out any position
			var len = dropTarget.children.length;
			var i;
			var el;
			var rect;
			for (i = 0; i < len; i++) {
				el = dropTarget.children[i];
				rect = el.getBoundingClientRect();
				if (horizontal && (rect.left + rect.width / 2) > x) {
					return el;
				}
				if (!horizontal && (rect.top + rect.height / 2) > y) {
					return el;
				}
			}
			return null;
		}

		function inside() { // faster, but only available if dropped inside a child element
			var rect = target.getBoundingClientRect();
			if (horizontal) {
				return resolve(x > rect.left + getRectWidth(rect) / 2);
			}
			return resolve(y > rect.top + getRectHeight(rect) / 2);
		}

		function resolve(after) {
			return after ? nextEl(target) : target;
		}
	}

	function isCopy(item, container) {
		return typeof o.copy === 'boolean' ? o.copy : o.copy(item, container);
	}
}

function touchy(el, op, type, fn) {
	var touch = {
		mouseup: 'touchend',
		mousedown: 'touchstart',
		mousemove: 'touchmove'
	};
	var pointers = {
		mouseup: 'pointerup',
		mousedown: 'pointerdown',
		mousemove: 'pointermove'
	};
	var microsoft = {
		mouseup: 'MSPointerUp',
		mousedown: 'MSPointerDown',
		mousemove: 'MSPointerMove'
	};
	if (global.navigator.pointerEnabled) {
		crossvent[op](el, pointers[type], fn);
	} else if (global.navigator.msPointerEnabled) {
		crossvent[op](el, microsoft[type], fn);
	} else {
		crossvent[op](el, touch[type], fn);
		crossvent[op](el, type, fn);
	}
}

function whichMouseButton(e) {
	if (e.touches !== void 0) {
		return e.touches.length;
	}
	if (e.which !== void 0 && e.which !== 0) {
		return e.which;
	} // see https://github.com/bevacqua/dragula/issues/261
	if (e.buttons !== void 0) {
		return e.buttons;
	}
	var button = e.button;
	if (button !== void 0) { // see https://github.com/jquery/jquery/blob/99e8ff1baa7ae341e94bb89c3e84570c7c3ad9ea/src/event.js#L573-L575
		return button & 1 ? 1 : button & 2 ? 3 : (button & 4 ? 2 : 0);
	}
}

function getOffset(el) {
	var rect = el.getBoundingClientRect();
	return {
		left: rect.left + getScroll('scrollLeft', 'pageXOffset'),
		top: rect.top + getScroll('scrollTop', 'pageYOffset')
	};
}

function getScroll(scrollProp, offsetProp) {
	if (typeof global[offsetProp] !== 'undefined') {
		return global[offsetProp];
	}
	if (documentElement.clientHeight) {
		return documentElement[scrollProp];
	}
	return doc.body[scrollProp];
}

function getElementBehindPoint(point, x, y) {
	var p = point || {};
	var state = p.className;
	var el;
	p.className += ' gu-hide';
	el = doc.elementFromPoint(x, y);
	p.className = state;
	return el;
}

function never() {
	return false;
}

function always() {
	return true;
}

function getRectWidth(rect) {
	return rect.width || (rect.right - rect.left);
}

function getRectHeight(rect) {
	return rect.height || (rect.bottom - rect.top);
}

function getParent(el) {
	return el.parentNode === doc ? null : el.parentNode;
}

function isInput(el) {
	return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || isEditable(el);
}

function isEditable(el) {
	if (!el) {
		return false;
	} // no parents were editable
	if (el.contentEditable === 'false') {
		return false;
	} // stop the lookup
	if (el.contentEditable === 'true') {
		return true;
	} // found a contentEditable element in the chain
	return isEditable(getParent(el)); // contentEditable is set to 'inherit'
}

function nextEl(el) {
	return el.nextElementSibling || manually();

	function manually() {
		var sibling = el;
		do {
			sibling = sibling.nextSibling;
		} while (sibling && sibling.nodeType !== 1);
		return sibling;
	}
}

function getEventHost(e) {
	// on touchend event, we have to use `e.changedTouches`
	// see http://stackoverflow.com/questions/7192563/touchend-event-properties
	// see https://github.com/bevacqua/dragula/issues/34
	if (e.targetTouches && e.targetTouches.length) {
		return e.targetTouches[0];
	}
	if (e.changedTouches && e.changedTouches.length) {
		return e.changedTouches[0];
	}
	return e;
}

function getCoord(coord, e) {
	var host = getEventHost(e);
	var missMap = {
		pageX: 'clientX', // IE8
		pageY: 'clientY' // IE8
	};
	if (coord in missMap && !(coord in host) && missMap[coord] in host) {
		coord = missMap[coord];
	}
	return host[coord];
}

module.exports = dragula;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./classes":1,"contra/emitter":5,"crossvent":6,"fastdom":10,"fastdom/extensions/fastdom-promised":9}],3:[function(require,module,exports){
module.exports = function atoa (a, n) { return Array.prototype.slice.call(a, n); }

},{}],4:[function(require,module,exports){
'use strict';

var ticky = require('ticky');

module.exports = function debounce (fn, args, ctx) {
  if (!fn) { return; }
  ticky(function run () {
    fn.apply(ctx || null, args || []);
  });
};

},{"ticky":11}],5:[function(require,module,exports){
'use strict';

var atoa = require('atoa');
var debounce = require('./debounce');

module.exports = function emitter (thing, options) {
  var opts = options || {};
  var evt = {};
  if (thing === undefined) { thing = {}; }
  thing.on = function (type, fn) {
    if (!evt[type]) {
      evt[type] = [fn];
    } else {
      evt[type].push(fn);
    }
    return thing;
  };
  thing.once = function (type, fn) {
    fn._once = true; // thing.off(fn) still works!
    thing.on(type, fn);
    return thing;
  };
  thing.off = function (type, fn) {
    var c = arguments.length;
    if (c === 1) {
      delete evt[type];
    } else if (c === 0) {
      evt = {};
    } else {
      var et = evt[type];
      if (!et) { return thing; }
      et.splice(et.indexOf(fn), 1);
    }
    return thing;
  };
  thing.emit = function () {
    var args = atoa(arguments);
    return thing.emitterSnapshot(args.shift()).apply(this, args);
  };
  thing.emitterSnapshot = function (type) {
    var et = (evt[type] || []).slice(0);
    return function () {
      var args = atoa(arguments);
      var ctx = this || thing;
      if (type === 'error' && opts.throws !== false && !et.length) { throw args.length === 1 ? args[0] : args; }
      et.forEach(function emitter (listen) {
        if (opts.async) { debounce(listen, args, ctx); } else { listen.apply(ctx, args); }
        if (listen._once) { thing.off(type, listen); }
      });
      return thing;
    };
  };
  return thing;
};

},{"./debounce":4,"atoa":3}],6:[function(require,module,exports){
(function (global){
'use strict';

var customEvent = require('custom-event');
var eventmap = require('./eventmap');
var doc = global.document;
var addEvent = addEventEasy;
var removeEvent = removeEventEasy;
var hardCache = [];

if (!global.addEventListener) {
  addEvent = addEventHard;
  removeEvent = removeEventHard;
}

module.exports = {
  add: addEvent,
  remove: removeEvent,
  fabricate: fabricateEvent
};

function addEventEasy (el, type, fn, capturing) {
  return el.addEventListener(type, fn, capturing);
}

function addEventHard (el, type, fn) {
  return el.attachEvent('on' + type, wrap(el, type, fn));
}

function removeEventEasy (el, type, fn, capturing) {
  return el.removeEventListener(type, fn, capturing);
}

function removeEventHard (el, type, fn) {
  var listener = unwrap(el, type, fn);
  if (listener) {
    return el.detachEvent('on' + type, listener);
  }
}

function fabricateEvent (el, type, model) {
  var e = eventmap.indexOf(type) === -1 ? makeCustomEvent() : makeClassicEvent();
  if (el.dispatchEvent) {
    el.dispatchEvent(e);
  } else {
    el.fireEvent('on' + type, e);
  }
  function makeClassicEvent () {
    var e;
    if (doc.createEvent) {
      e = doc.createEvent('Event');
      e.initEvent(type, true, true);
    } else if (doc.createEventObject) {
      e = doc.createEventObject();
    }
    return e;
  }
  function makeCustomEvent () {
    return new customEvent(type, { detail: model });
  }
}

function wrapperFactory (el, type, fn) {
  return function wrapper (originalEvent) {
    var e = originalEvent || global.event;
    e.target = e.target || e.srcElement;
    e.preventDefault = e.preventDefault || function preventDefault () { e.returnValue = false; };
    e.stopPropagation = e.stopPropagation || function stopPropagation () { e.cancelBubble = true; };
    e.which = e.which || e.keyCode;
    fn.call(el, e);
  };
}

function wrap (el, type, fn) {
  var wrapper = unwrap(el, type, fn) || wrapperFactory(el, type, fn);
  hardCache.push({
    wrapper: wrapper,
    element: el,
    type: type,
    fn: fn
  });
  return wrapper;
}

function unwrap (el, type, fn) {
  var i = find(el, type, fn);
  if (i) {
    var wrapper = hardCache[i].wrapper;
    hardCache.splice(i, 1); // free up a tad of memory
    return wrapper;
  }
}

function find (el, type, fn) {
  var i, item;
  for (i = 0; i < hardCache.length; i++) {
    item = hardCache[i];
    if (item.element === el && item.type === type && item.fn === fn) {
      return i;
    }
  }
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./eventmap":7,"custom-event":8}],7:[function(require,module,exports){
(function (global){
'use strict';

var eventmap = [];
var eventname = '';
var ron = /^on/;

for (eventname in global) {
  if (ron.test(eventname)) {
    eventmap.push(eventname.slice(2));
  }
}

module.exports = eventmap;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],8:[function(require,module,exports){
(function (global){

var NativeCustomEvent = global.CustomEvent;

function useNative () {
  try {
    var p = new NativeCustomEvent('cat', { detail: { foo: 'bar' } });
    return  'cat' === p.type && 'bar' === p.detail.foo;
  } catch (e) {
  }
  return false;
}

/**
 * Cross-browser `CustomEvent` constructor.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent.CustomEvent
 *
 * @public
 */

module.exports = useNative() ? NativeCustomEvent :

// IE >= 9
'function' === typeof document.createEvent ? function CustomEvent (type, params) {
  var e = document.createEvent('CustomEvent');
  if (params) {
    e.initCustomEvent(type, params.bubbles, params.cancelable, params.detail);
  } else {
    e.initCustomEvent(type, false, false, void 0);
  }
  return e;
} :

// IE <= 8
function CustomEvent (type, params) {
  var e = document.createEventObject();
  e.type = type;
  if (params) {
    e.bubbles = Boolean(params.bubbles);
    e.cancelable = Boolean(params.cancelable);
    e.detail = params.detail;
  } else {
    e.bubbles = false;
    e.cancelable = false;
    e.detail = void 0;
  }
  return e;
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],9:[function(require,module,exports){
!(function() {

/**
 * Wraps fastdom in a Promise API
 * for improved control-flow.
 *
 * @example
 *
 * // returning a result
 * fastdom.measure(() => el.clientWidth)
 *   .then(result => ...);
 *
 * // returning promises from tasks
 * fastdom.measure(() => {
 *   var w = el1.clientWidth;
 *   return fastdom.mutate(() => el2.style.width = w + 'px');
 * }).then(() => console.log('all done'));
 *
 * // clearing pending tasks
 * var promise = fastdom.measure(...)
 * fastdom.clear(promise);
 *
 * @type {Object}
 */
var exports = {
  initialize: function() {
    this._tasks = new Map();
  },

  mutate: function(fn, ctx) {
    return create(this, 'mutate', fn, ctx);
  },

  measure: function(fn, ctx) {
    return create(this, 'measure', fn, ctx);
  },

  clear: function(promise) {
    var tasks = this._tasks;
    var task = tasks.get(promise);
    this.fastdom.clear(task);
    tasks.delete(task);
  }
};

/**
 * Create a fastdom task wrapped in
 * a 'cancellable' Promise.
 *
 * @param  {FastDom}  fastdom
 * @param  {String}   type - 'measure'|'muatate'
 * @param  {Function} fn
 * @return {Promise}
 */
function create(promised, type, fn, ctx) {
  var tasks = promised._tasks;
  var fastdom = promised.fastdom;
  var task;

  var promise = new Promise(function(resolve, reject) {
    task = fastdom[type](function() {
      tasks.delete(promise);
      try { resolve(ctx ? fn.call(ctx) : fn()); }
      catch (e) { reject(e); }
    }, ctx);
  });

  tasks.set(promise, task);
  return promise;
}

// Expose to CJS, AMD or global
if ((typeof define)[0] == 'f') define(function() { return exports; });
else if ((typeof module)[0] == 'o') module.exports = exports;
else window.fastdomPromised = exports;

})();
},{}],10:[function(require,module,exports){
!(function(win) {

/**
 * FastDom
 *
 * Eliminates layout thrashing
 * by batching DOM read/write
 * interactions.
 *
 * @author Wilson Page <wilsonpage@me.com>
 * @author Kornel Lesinski <kornel.lesinski@ft.com>
 */

'use strict';

/**
 * Mini logger
 *
 * @return {Function}
 */
var debug = 0 ? console.log.bind(console, '[fastdom]') : function() {};

/**
 * Normalized rAF
 *
 * @type {Function}
 */
var raf = win.requestAnimationFrame
  || win.webkitRequestAnimationFrame
  || win.mozRequestAnimationFrame
  || win.msRequestAnimationFrame
  || function(cb) { return setTimeout(cb, 16); };

/**
 * Initialize a `FastDom`.
 *
 * @constructor
 */
function FastDom() {
  var self = this;
  self.reads = [];
  self.writes = [];
  self.raf = raf.bind(win); // test hook
  debug('initialized', self);
}

FastDom.prototype = {
  constructor: FastDom,

  /**
   * Adds a job to the read batch and
   * schedules a new frame if need be.
   *
   * @param  {Function} fn
   * @public
   */
  measure: function(fn, ctx) {
    debug('measure');
    var task = !ctx ? fn : fn.bind(ctx);
    this.reads.push(task);
    scheduleFlush(this);
    return task;
  },

  /**
   * Adds a job to the
   * write batch and schedules
   * a new frame if need be.
   *
   * @param  {Function} fn
   * @public
   */
  mutate: function(fn, ctx) {
    debug('mutate');
    var task = !ctx ? fn : fn.bind(ctx);
    this.writes.push(task);
    scheduleFlush(this);
    return task;
  },

  /**
   * Clears a scheduled 'read' or 'write' task.
   *
   * @param {Object} task
   * @return {Boolean} success
   * @public
   */
  clear: function(task) {
    debug('clear', task);
    return remove(this.reads, task) || remove(this.writes, task);
  },

  /**
   * Extend this FastDom with some
   * custom functionality.
   *
   * Because fastdom must *always* be a
   * singleton, we're actually extending
   * the fastdom instance. This means tasks
   * scheduled by an extension still enter
   * fastdom's global task queue.
   *
   * The 'super' instance can be accessed
   * from `this.fastdom`.
   *
   * @example
   *
   * var myFastdom = fastdom.extend({
   *   initialize: function() {
   *     // runs on creation
   *   },
   *
   *   // override a method
   *   measure: function(fn) {
   *     // do extra stuff ...
   *
   *     // then call the original
   *     return this.fastdom.measure(fn);
   *   },
   *
   *   ...
   * });
   *
   * @param  {Object} props  properties to mixin
   * @return {FastDom}
   */
  extend: function(props) {
    debug('extend', props);
    if (typeof props != 'object') throw new Error('expected object');

    var child = Object.create(this);
    mixin(child, props);
    child.fastdom = this;

    // run optional creation hook
    if (child.initialize) child.initialize();

    return child;
  },

  // override this with a function
  // to prevent Errors in console
  // when tasks throw
  catch: null
};

/**
 * Schedules a new read/write
 * batch if one isn't pending.
 *
 * @private
 */
function scheduleFlush(fastdom) {
  if (!fastdom.scheduled) {
    fastdom.scheduled = true;
    fastdom.raf(flush.bind(null, fastdom));
    debug('flush scheduled');
  }
}

/**
 * Runs queued `read` and `write` tasks.
 *
 * Errors are caught and thrown by default.
 * If a `.catch` function has been defined
 * it is called instead.
 *
 * @private
 */
function flush(fastdom) {
  debug('flush');

  var writes = fastdom.writes;
  var reads = fastdom.reads;
  var error;

  try {
    debug('flushing reads', reads.length);
    runTasks(reads);
    debug('flushing writes', writes.length);
    runTasks(writes);
  } catch (e) { error = e; }

  fastdom.scheduled = false;

  // If the batch errored we may still have tasks queued
  if (reads.length || writes.length) scheduleFlush(fastdom);

  if (error) {
    debug('task errored', error.message);
    if (fastdom.catch) fastdom.catch(error);
    else throw error;
  }
}

/**
 * We run this inside a try catch
 * so that if any jobs error, we
 * are able to recover and continue
 * to flush the batch until it's empty.
 *
 * @private
 */
function runTasks(tasks) {
  debug('run tasks');
  var task; while (task = tasks.shift()) task();
}

/**
 * Remove an item from an Array.
 *
 * @param  {Array} array
 * @param  {*} item
 * @return {Boolean}
 */
function remove(array, item) {
  var index = array.indexOf(item);
  return !!~index && !!array.splice(index, 1);
}

/**
 * Mixin own properties of source
 * object into the target.
 *
 * @param  {Object} target
 * @param  {Object} source
 */
function mixin(target, source) {
  for (var key in source) {
    if (source.hasOwnProperty(key)) target[key] = source[key];
  }
}

// There should never be more than
// one instance of `FastDom` in an app
var exports = win.fastdom = (win.fastdom || new FastDom()); // jshint ignore:line

// Expose to CJS & AMD
if ((typeof define)[0] == 'f') define(function() { return exports; });
else if ((typeof module)[0] == 'o') module.exports = exports;

})( window || this);

},{}],11:[function(require,module,exports){
var si = typeof setImmediate === 'function', tick;
if (si) {
  tick = function (fn) { setImmediate(fn); };
} else {
  tick = function (fn) { setTimeout(fn, 0); };
}

module.exports = tick;
},{}]},{},[2])(2)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJjbGFzc2VzLmpzIiwiZHJhZ3VsYS5qcyIsIm5vZGVfbW9kdWxlcy9hdG9hL2F0b2EuanMiLCJub2RlX21vZHVsZXMvY29udHJhL2RlYm91bmNlLmpzIiwibm9kZV9tb2R1bGVzL2NvbnRyYS9lbWl0dGVyLmpzIiwibm9kZV9tb2R1bGVzL2Nyb3NzdmVudC9zcmMvY3Jvc3N2ZW50LmpzIiwibm9kZV9tb2R1bGVzL2Nyb3NzdmVudC9zcmMvZXZlbnRtYXAuanMiLCJub2RlX21vZHVsZXMvY3VzdG9tLWV2ZW50L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Zhc3Rkb20vZXh0ZW5zaW9ucy9mYXN0ZG9tLXByb21pc2VkLmpzIiwibm9kZV9tb2R1bGVzL2Zhc3Rkb20vZmFzdGRvbS5qcyIsIm5vZGVfbW9kdWxlcy90aWNreS90aWNreS1icm93c2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNwckJBO0FBQ0E7O0FDREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNyR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2hEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2FjaGUgPSB7fTtcbnZhciBzdGFydCA9ICcoPzpefFxcXFxzKSc7XG52YXIgZW5kID0gJyg/OlxcXFxzfCQpJztcblxuZnVuY3Rpb24gbG9va3VwQ2xhc3MgKGNsYXNzTmFtZSkge1xuICB2YXIgY2FjaGVkID0gY2FjaGVbY2xhc3NOYW1lXTtcbiAgaWYgKGNhY2hlZCkge1xuICAgIGNhY2hlZC5sYXN0SW5kZXggPSAwO1xuICB9IGVsc2Uge1xuICAgIGNhY2hlW2NsYXNzTmFtZV0gPSBjYWNoZWQgPSBuZXcgUmVnRXhwKHN0YXJ0ICsgY2xhc3NOYW1lICsgZW5kLCAnZycpO1xuICB9XG4gIHJldHVybiBjYWNoZWQ7XG59XG5cbmZ1bmN0aW9uIGFkZENsYXNzIChlbCwgY2xhc3NOYW1lKSB7XG4gIHZhciBjdXJyZW50ID0gZWwuY2xhc3NOYW1lO1xuICBpZiAoIWN1cnJlbnQubGVuZ3RoKSB7XG4gICAgZWwuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICB9IGVsc2UgaWYgKCFsb29rdXBDbGFzcyhjbGFzc05hbWUpLnRlc3QoY3VycmVudCkpIHtcbiAgICBlbC5jbGFzc05hbWUgKz0gJyAnICsgY2xhc3NOYW1lO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJtQ2xhc3MgKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwuY2xhc3NOYW1lID0gZWwuY2xhc3NOYW1lLnJlcGxhY2UobG9va3VwQ2xhc3MoY2xhc3NOYW1lKSwgJyAnKS50cmltKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBhZGQ6IGFkZENsYXNzLFxuICBybTogcm1DbGFzc1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGVtaXR0ZXIgPSByZXF1aXJlKCdjb250cmEvZW1pdHRlcicpO1xudmFyIGNyb3NzdmVudCA9IHJlcXVpcmUoJ2Nyb3NzdmVudCcpO1xudmFyIGZhc3Rkb20gPSByZXF1aXJlKCdmYXN0ZG9tJyk7XG52YXIgZmFzdGRvbVByb21pc2VkID0gcmVxdWlyZSgnZmFzdGRvbS9leHRlbnNpb25zL2Zhc3Rkb20tcHJvbWlzZWQnKTtcbnZhciBjbGFzc2VzID0gcmVxdWlyZSgnLi9jbGFzc2VzJyk7XG52YXIgZG9jID0gZG9jdW1lbnQ7XG52YXIgZG9jdW1lbnRFbGVtZW50ID0gZG9jLmRvY3VtZW50RWxlbWVudDtcblxuZnVuY3Rpb24gZHJhZ3VsYShpbml0aWFsQ29udGFpbmVycywgb3B0aW9ucykge1xuXHR2YXIgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcblx0aWYgKGxlbiA9PT0gMSAmJiBBcnJheS5pc0FycmF5KGluaXRpYWxDb250YWluZXJzKSA9PT0gZmFsc2UpIHtcblx0XHRvcHRpb25zID0gaW5pdGlhbENvbnRhaW5lcnM7XG5cdFx0aW5pdGlhbENvbnRhaW5lcnMgPSBbXTtcblx0fVxuXHR2YXIgX21pcnJvcjsgLy8gbWlycm9yIGltYWdlXG5cdHZhciBfc291cmNlOyAvLyBzb3VyY2UgY29udGFpbmVyXG5cdHZhciBfaXRlbTsgLy8gaXRlbSBiZWluZyBkcmFnZ2VkXG5cdHZhciBfb2Zmc2V0WDsgLy8gcmVmZXJlbmNlIHhcblx0dmFyIF9vZmZzZXRZOyAvLyByZWZlcmVuY2UgeVxuXHR2YXIgX21vdmVYOyAvLyByZWZlcmVuY2UgbW92ZSB4XG5cdHZhciBfbW92ZVk7IC8vIHJlZmVyZW5jZSBtb3ZlIHlcblx0dmFyIF9pbml0aWFsU2libGluZzsgLy8gcmVmZXJlbmNlIHNpYmxpbmcgd2hlbiBncmFiYmVkXG5cdHZhciBfY3VycmVudFNpYmxpbmc7IC8vIHJlZmVyZW5jZSBzaWJsaW5nIG5vd1xuXHR2YXIgX2NvcHk7IC8vIGl0ZW0gdXNlZCBmb3IgY29weWluZ1xuXHR2YXIgX3JlbmRlclRpbWVyOyAvLyB0aW1lciBmb3Igc2V0VGltZW91dCByZW5kZXJNaXJyb3JJbWFnZVxuXHR2YXIgX2xhc3REcm9wVGFyZ2V0ID0gbnVsbDsgLy8gbGFzdCBjb250YWluZXIgaXRlbSB3YXMgb3ZlclxuXHR2YXIgX2dyYWJiZWQ7IC8vIGhvbGRzIG1vdXNlZG93biBjb250ZXh0IHVudGlsIGZpcnN0IG1vdXNlbW92ZVxuXG5cdHZhciBvID0gb3B0aW9ucyB8fCB7fTtcblx0aWYgKG8ubW92ZXMgPT09IHZvaWQgMCkge1xuXHRcdG8ubW92ZXMgPSBhbHdheXM7XG5cdH1cblx0aWYgKG8uYWNjZXB0cyA9PT0gdm9pZCAwKSB7XG5cdFx0by5hY2NlcHRzID0gYWx3YXlzO1xuXHR9XG5cdGlmIChvLmludmFsaWQgPT09IHZvaWQgMCkge1xuXHRcdG8uaW52YWxpZCA9IGludmFsaWRUYXJnZXQ7XG5cdH1cblx0aWYgKG8uY29udGFpbmVycyA9PT0gdm9pZCAwKSB7XG5cdFx0by5jb250YWluZXJzID0gaW5pdGlhbENvbnRhaW5lcnMgfHwgW107XG5cdH1cblx0aWYgKG8uaXNDb250YWluZXIgPT09IHZvaWQgMCkge1xuXHRcdG8uaXNDb250YWluZXIgPSBuZXZlcjtcblx0fVxuXHRpZiAoby5jb3B5ID09PSB2b2lkIDApIHtcblx0XHRvLmNvcHkgPSBmYWxzZTtcblx0fVxuXHRpZiAoby5jb3B5U29ydFNvdXJjZSA9PT0gdm9pZCAwKSB7XG5cdFx0by5jb3B5U29ydFNvdXJjZSA9IGZhbHNlO1xuXHR9XG5cdGlmIChvLnJldmVydE9uU3BpbGwgPT09IHZvaWQgMCkge1xuXHRcdG8ucmV2ZXJ0T25TcGlsbCA9IGZhbHNlO1xuXHR9XG5cdGlmIChvLnJlbW92ZU9uU3BpbGwgPT09IHZvaWQgMCkge1xuXHRcdG8ucmVtb3ZlT25TcGlsbCA9IGZhbHNlO1xuXHR9XG5cdGlmIChvLmRpcmVjdGlvbiA9PT0gdm9pZCAwKSB7XG5cdFx0by5kaXJlY3Rpb24gPSAndmVydGljYWwnO1xuXHR9XG5cdGlmIChvLmlnbm9yZUlucHV0VGV4dFNlbGVjdGlvbiA9PT0gdm9pZCAwKSB7XG5cdFx0by5pZ25vcmVJbnB1dFRleHRTZWxlY3Rpb24gPSB0cnVlO1xuXHR9XG5cdGlmIChvLm1pcnJvckNvbnRhaW5lciA9PT0gdm9pZCAwKSB7XG5cdFx0by5taXJyb3JDb250YWluZXIgPSBkb2MuYm9keTtcblx0fVxuXG5cdHZhciBkcmFrZSA9IGVtaXR0ZXIoe1xuXHRcdGNvbnRhaW5lcnM6IG8uY29udGFpbmVycyxcblx0XHRzdGFydDogbWFudWFsU3RhcnQsXG5cdFx0ZW5kOiBlbmQsXG5cdFx0Y2FuY2VsOiBjYW5jZWwsXG5cdFx0cmVtb3ZlOiByZW1vdmUsXG5cdFx0ZGVzdHJveTogZGVzdHJveSxcblx0XHRjYW5Nb3ZlOiBjYW5Nb3ZlLFxuXHRcdGRyYWdnaW5nOiBmYWxzZVxuXHR9KTtcblxuXHRpZiAoby5yZW1vdmVPblNwaWxsID09PSB0cnVlKSB7XG5cdFx0ZHJha2Uub24oJ292ZXInLCBzcGlsbE92ZXIpLm9uKCdvdXQnLCBzcGlsbE91dCk7XG5cdH1cblxuXHRldmVudHMoKTtcblxuXHRyZXR1cm4gZHJha2U7XG5cblx0ZnVuY3Rpb24gaXNDb250YWluZXIoZWwpIHtcblx0XHRyZXR1cm4gZHJha2UuY29udGFpbmVycy5pbmRleE9mKGVsKSAhPT0gLTEgfHwgby5pc0NvbnRhaW5lcihlbCk7XG5cdH1cblxuXHRmdW5jdGlvbiBldmVudHMocmVtb3ZlKSB7XG5cdFx0dmFyIG9wID0gcmVtb3ZlID8gJ3JlbW92ZScgOiAnYWRkJztcblx0XHR0b3VjaHkoZG9jdW1lbnRFbGVtZW50LCBvcCwgJ21vdXNlZG93bicsIGdyYWIpO1xuXHRcdHRvdWNoeShkb2N1bWVudEVsZW1lbnQsIG9wLCAnbW91c2V1cCcsIHJlbGVhc2UpO1xuXHR9XG5cblx0ZnVuY3Rpb24gZXZlbnR1YWxNb3ZlbWVudHMocmVtb3ZlKSB7XG5cdFx0dmFyIG9wID0gcmVtb3ZlID8gJ3JlbW92ZScgOiAnYWRkJztcblx0XHR0b3VjaHkoZG9jdW1lbnRFbGVtZW50LCBvcCwgJ21vdXNlbW92ZScsIHN0YXJ0QmVjYXVzZU1vdXNlTW92ZWQpO1xuXHR9XG5cblx0ZnVuY3Rpb24gbW92ZW1lbnRzKHJlbW92ZSkge1xuXHRcdHZhciBvcCA9IHJlbW92ZSA/ICdyZW1vdmUnIDogJ2FkZCc7XG5cdFx0Y3Jvc3N2ZW50W29wXShkb2N1bWVudEVsZW1lbnQsICdzZWxlY3RzdGFydCcsIHByZXZlbnRHcmFiYmVkKTsgLy8gSUU4XG5cdFx0Y3Jvc3N2ZW50W29wXShkb2N1bWVudEVsZW1lbnQsICdjbGljaycsIHByZXZlbnRHcmFiYmVkKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGRlc3Ryb3koKSB7XG5cdFx0ZXZlbnRzKHRydWUpO1xuXHRcdHJlbGVhc2Uoe30pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJldmVudEdyYWJiZWQoZSkge1xuXHRcdGlmIChfZ3JhYmJlZCkge1xuXHRcdFx0ZS5wcmV2ZW50RGVmYXVsdCgpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIGdyYWIoZSkge1xuXHRcdF9tb3ZlWCA9IGUuY2xpZW50WDtcblx0XHRfbW92ZVkgPSBlLmNsaWVudFk7XG5cblx0XHR2YXIgaWdub3JlID0gd2hpY2hNb3VzZUJ1dHRvbihlKSAhPT0gMSB8fCBlLm1ldGFLZXkgfHwgZS5jdHJsS2V5O1xuXHRcdGlmIChpZ25vcmUpIHtcblx0XHRcdHJldHVybjsgLy8gd2Ugb25seSBjYXJlIGFib3V0IGhvbmVzdC10by1nb2QgbGVmdCBjbGlja3MgYW5kIHRvdWNoIGV2ZW50c1xuXHRcdH1cblx0XHR2YXIgaXRlbSA9IGUudGFyZ2V0O1xuXHRcdHZhciBjb250ZXh0ID0gY2FuU3RhcnQoaXRlbSk7XG5cdFx0aWYgKCFjb250ZXh0KSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdF9ncmFiYmVkID0gY29udGV4dDtcblx0XHRldmVudHVhbE1vdmVtZW50cygpO1xuXHRcdGlmIChlLnR5cGUgPT09ICdtb3VzZWRvd24nKSB7XG5cdFx0XHRpZiAoaXNJbnB1dChpdGVtKSkgeyAvLyBzZWUgYWxzbzogaHR0cHM6Ly9naXRodWIuY29tL2JldmFjcXVhL2RyYWd1bGEvaXNzdWVzLzIwOFxuXHRcdFx0XHRpdGVtLmZvY3VzKCk7IC8vIGZpeGVzIGh0dHBzOi8vZ2l0aHViLmNvbS9iZXZhY3F1YS9kcmFndWxhL2lzc3Vlcy8xNzZcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGUucHJldmVudERlZmF1bHQoKTsgLy8gZml4ZXMgaHR0cHM6Ly9naXRodWIuY29tL2JldmFjcXVhL2RyYWd1bGEvaXNzdWVzLzE1NVxuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHN0YXJ0QmVjYXVzZU1vdXNlTW92ZWQoZSkge1xuXHRcdGlmICghX2dyYWJiZWQpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aWYgKHdoaWNoTW91c2VCdXR0b24oZSkgPT09IDApIHtcblx0XHRcdHJlbGVhc2Uoe30pO1xuXHRcdFx0cmV0dXJuOyAvLyB3aGVuIHRleHQgaXMgc2VsZWN0ZWQgb24gYW4gaW5wdXQgYW5kIHRoZW4gZHJhZ2dlZCwgbW91c2V1cCBkb2Vzbid0IGZpcmUuIHRoaXMgaXMgb3VyIG9ubHkgaG9wZVxuXHRcdH1cblx0XHQvLyB0cnV0aHkgY2hlY2sgZml4ZXMgIzIzOSwgZXF1YWxpdHkgZml4ZXMgIzIwN1xuXHRcdGlmIChlLmNsaWVudFggIT09IHZvaWQgMCAmJiBlLmNsaWVudFggPT09IF9tb3ZlWCAmJiBlLmNsaWVudFkgIT09IHZvaWQgMCAmJiBlLmNsaWVudFkgPT09IF9tb3ZlWSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAoby5pZ25vcmVJbnB1dFRleHRTZWxlY3Rpb24pIHtcblx0XHRcdHZhciBjbGllbnRYID0gZ2V0Q29vcmQoJ2NsaWVudFgnLCBlKTtcblx0XHRcdHZhciBjbGllbnRZID0gZ2V0Q29vcmQoJ2NsaWVudFknLCBlKTtcblx0XHRcdHZhciBlbGVtZW50QmVoaW5kQ3Vyc29yID0gZG9jLmVsZW1lbnRGcm9tUG9pbnQoY2xpZW50WCwgY2xpZW50WSk7XG5cdFx0XHRpZiAoaXNJbnB1dChlbGVtZW50QmVoaW5kQ3Vyc29yKSkge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0dmFyIGdyYWJiZWQgPSBfZ3JhYmJlZDsgLy8gY2FsbCB0byBlbmQoKSB1bnNldHMgX2dyYWJiZWRcblx0XHRldmVudHVhbE1vdmVtZW50cyh0cnVlKTtcblx0XHRtb3ZlbWVudHMoKTtcblx0XHRlbmQoKTtcblx0XHRzdGFydChncmFiYmVkKTtcblxuXHRcdHZhciBvZmZzZXQgPSBnZXRPZmZzZXQoX2l0ZW0pO1xuXHRcdF9vZmZzZXRYID0gZ2V0Q29vcmQoJ3BhZ2VYJywgZSkgLSBvZmZzZXQubGVmdDtcblx0XHRfb2Zmc2V0WSA9IGdldENvb3JkKCdwYWdlWScsIGUpIC0gb2Zmc2V0LnRvcDtcblxuXHRcdGNsYXNzZXMuYWRkKF9jb3B5IHx8IF9pdGVtLCAnZ3UtdHJhbnNpdCcpO1xuXHRcdHJlbmRlck1pcnJvckltYWdlKCk7XG5cdFx0ZHJhZyhlKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGNhblN0YXJ0KGl0ZW0pIHtcblx0XHRpZiAoZHJha2UuZHJhZ2dpbmcgJiYgX21pcnJvcikge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAoaXNDb250YWluZXIoaXRlbSkpIHtcblx0XHRcdHJldHVybjsgLy8gZG9uJ3QgZHJhZyBjb250YWluZXIgaXRzZWxmXG5cdFx0fVxuXHRcdHZhciBoYW5kbGUgPSBpdGVtO1xuXHRcdHdoaWxlIChnZXRQYXJlbnQoaXRlbSkgJiYgaXNDb250YWluZXIoZ2V0UGFyZW50KGl0ZW0pKSA9PT0gZmFsc2UpIHtcblx0XHRcdGlmIChvLmludmFsaWQoaXRlbSwgaGFuZGxlKSkge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cdFx0XHRpdGVtID0gZ2V0UGFyZW50KGl0ZW0pOyAvLyBkcmFnIHRhcmdldCBzaG91bGQgYmUgYSB0b3AgZWxlbWVudFxuXHRcdFx0aWYgKCFpdGVtKSB7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblx0XHR9XG5cdFx0dmFyIHNvdXJjZSA9IGdldFBhcmVudChpdGVtKTtcblx0XHRpZiAoIXNvdXJjZSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAoby5pbnZhbGlkKGl0ZW0sIGhhbmRsZSkpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cblx0XHR2YXIgbW92YWJsZSA9IG8ubW92ZXMoaXRlbSwgc291cmNlLCBoYW5kbGUsIG5leHRFbChpdGVtKSk7XG5cdFx0aWYgKCFtb3ZhYmxlKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGl0ZW06IGl0ZW0sXG5cdFx0XHRzb3VyY2U6IHNvdXJjZVxuXHRcdH07XG5cdH1cblxuXHRmdW5jdGlvbiBjYW5Nb3ZlKGl0ZW0pIHtcblx0XHRyZXR1cm4gISFjYW5TdGFydChpdGVtKTtcblx0fVxuXG5cdGZ1bmN0aW9uIG1hbnVhbFN0YXJ0KGl0ZW0pIHtcblx0XHR2YXIgY29udGV4dCA9IGNhblN0YXJ0KGl0ZW0pO1xuXHRcdGlmIChjb250ZXh0KSB7XG5cdFx0XHRzdGFydChjb250ZXh0KTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBzdGFydChjb250ZXh0KSB7XG5cdFx0aWYgKGlzQ29weShjb250ZXh0Lml0ZW0sIGNvbnRleHQuc291cmNlKSkge1xuXHRcdFx0X2NvcHkgPSBjb250ZXh0Lml0ZW0uY2xvbmVOb2RlKHRydWUpO1xuXHRcdFx0ZHJha2UuZW1pdCgnY2xvbmVkJywgX2NvcHksIGNvbnRleHQuaXRlbSwgJ2NvcHknKTtcblx0XHR9XG5cblx0XHRfc291cmNlID0gY29udGV4dC5zb3VyY2U7XG5cdFx0X2l0ZW0gPSBjb250ZXh0Lml0ZW07XG5cdFx0X2luaXRpYWxTaWJsaW5nID0gX2N1cnJlbnRTaWJsaW5nID0gbmV4dEVsKGNvbnRleHQuaXRlbSk7XG5cblx0XHRkcmFrZS5kcmFnZ2luZyA9IHRydWU7XG5cdFx0ZHJha2UuZW1pdCgnZHJhZycsIF9pdGVtLCBfc291cmNlKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGludmFsaWRUYXJnZXQoKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gZW5kKCkge1xuXHRcdGlmICghZHJha2UuZHJhZ2dpbmcpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dmFyIGl0ZW0gPSBfY29weSB8fCBfaXRlbTtcblx0XHRkcm9wKGl0ZW0sIGdldFBhcmVudChpdGVtKSk7XG5cdH1cblxuXHRmdW5jdGlvbiB1bmdyYWIoKSB7XG5cdFx0X2dyYWJiZWQgPSBmYWxzZTtcblx0XHRldmVudHVhbE1vdmVtZW50cyh0cnVlKTtcblx0XHRtb3ZlbWVudHModHJ1ZSk7XG5cdH1cblxuXHRmdW5jdGlvbiByZWxlYXNlKGUpIHtcblx0XHR1bmdyYWIoKTtcblxuXHRcdGlmICghZHJha2UuZHJhZ2dpbmcpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dmFyIGl0ZW0gPSBfY29weSB8fCBfaXRlbTtcblx0XHR2YXIgY2xpZW50WCA9IGdldENvb3JkKCdjbGllbnRYJywgZSk7XG5cdFx0dmFyIGNsaWVudFkgPSBnZXRDb29yZCgnY2xpZW50WScsIGUpO1xuXHRcdHZhciBlbGVtZW50QmVoaW5kQ3Vyc29yID0gZ2V0RWxlbWVudEJlaGluZFBvaW50KF9taXJyb3IsIGNsaWVudFgsIGNsaWVudFkpO1xuXHRcdHZhciBkcm9wVGFyZ2V0ID0gZmluZERyb3BUYXJnZXQoZWxlbWVudEJlaGluZEN1cnNvciwgY2xpZW50WCwgY2xpZW50WSk7XG5cdFx0aWYgKGRyb3BUYXJnZXQgJiYgKChfY29weSAmJiBvLmNvcHlTb3J0U291cmNlKSB8fCAoIV9jb3B5IHx8IGRyb3BUYXJnZXQgIT09IF9zb3VyY2UpKSkge1xuXHRcdFx0ZHJvcChpdGVtLCBkcm9wVGFyZ2V0KTtcblx0XHR9IGVsc2UgaWYgKG8ucmVtb3ZlT25TcGlsbCkge1xuXHRcdFx0cmVtb3ZlKCk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGNhbmNlbCgpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIGRyb3AoaXRlbSwgdGFyZ2V0KSB7XG5cdFx0dmFyIHBhcmVudCA9IGdldFBhcmVudChpdGVtKTtcblx0XHRpZiAoX2NvcHkgJiYgby5jb3B5U29ydFNvdXJjZSAmJiB0YXJnZXQgPT09IF9zb3VyY2UpIHtcblx0XHRcdHBhcmVudC5yZW1vdmVDaGlsZChfaXRlbSk7XG5cdFx0fVxuXHRcdGlmIChpc0luaXRpYWxQbGFjZW1lbnQodGFyZ2V0KSkge1xuXHRcdFx0ZHJha2UuZW1pdCgnY2FuY2VsJywgaXRlbSwgX3NvdXJjZSwgX3NvdXJjZSk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGRyYWtlLmVtaXQoJ2Ryb3AnLCBpdGVtLCB0YXJnZXQsIF9zb3VyY2UsIF9jdXJyZW50U2libGluZyk7XG5cdFx0fVxuXHRcdGNsZWFudXAoKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZSgpIHtcblx0XHRpZiAoIWRyYWtlLmRyYWdnaW5nKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHZhciBpdGVtID0gX2NvcHkgfHwgX2l0ZW07XG5cdFx0dmFyIHBhcmVudCA9IGdldFBhcmVudChpdGVtKTtcblx0XHRpZiAocGFyZW50KSB7XG5cdFx0XHRwYXJlbnQucmVtb3ZlQ2hpbGQoaXRlbSk7XG5cdFx0fVxuXHRcdGRyYWtlLmVtaXQoX2NvcHkgPyAnY2FuY2VsJyA6ICdyZW1vdmUnLCBpdGVtLCBwYXJlbnQsIF9zb3VyY2UpO1xuXHRcdGNsZWFudXAoKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGNhbmNlbChyZXZlcnQpIHtcblx0XHRpZiAoIWRyYWtlLmRyYWdnaW5nKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHZhciByZXZlcnRzID0gYXJndW1lbnRzLmxlbmd0aCA+IDAgPyByZXZlcnQgOiBvLnJldmVydE9uU3BpbGw7XG5cdFx0dmFyIGl0ZW0gPSBfY29weSB8fCBfaXRlbTtcblx0XHR2YXIgcGFyZW50ID0gZ2V0UGFyZW50KGl0ZW0pO1xuXHRcdHZhciBpbml0aWFsID0gaXNJbml0aWFsUGxhY2VtZW50KHBhcmVudCk7XG5cdFx0aWYgKGluaXRpYWwgPT09IGZhbHNlICYmIHJldmVydHMpIHtcblx0XHRcdGlmIChfY29weSkge1xuXHRcdFx0XHRwYXJlbnQucmVtb3ZlQ2hpbGQoX2NvcHkpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0X3NvdXJjZS5pbnNlcnRCZWZvcmUoaXRlbSwgX2luaXRpYWxTaWJsaW5nKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0aWYgKGluaXRpYWwgfHwgcmV2ZXJ0cykge1xuXHRcdFx0ZHJha2UuZW1pdCgnY2FuY2VsJywgaXRlbSwgX3NvdXJjZSwgX3NvdXJjZSk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGRyYWtlLmVtaXQoJ2Ryb3AnLCBpdGVtLCBwYXJlbnQsIF9zb3VyY2UsIF9jdXJyZW50U2libGluZyk7XG5cdFx0fVxuXHRcdGNsZWFudXAoKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFudXAoKSB7XG5cdFx0dmFyIGl0ZW0gPSBfY29weSB8fCBfaXRlbTtcblx0XHR1bmdyYWIoKTtcblx0XHRyZW1vdmVNaXJyb3JJbWFnZSgpO1xuXHRcdGlmIChpdGVtKSB7XG5cdFx0XHRjbGFzc2VzLnJtKGl0ZW0sICdndS10cmFuc2l0Jyk7XG5cdFx0fVxuXHRcdGlmIChfcmVuZGVyVGltZXIpIHtcblx0XHRcdGNsZWFyVGltZW91dChfcmVuZGVyVGltZXIpO1xuXHRcdH1cblx0XHRkcmFrZS5kcmFnZ2luZyA9IGZhbHNlO1xuXHRcdGlmIChfbGFzdERyb3BUYXJnZXQpIHtcblx0XHRcdGRyYWtlLmVtaXQoJ291dCcsIGl0ZW0sIF9sYXN0RHJvcFRhcmdldCwgX3NvdXJjZSk7XG5cdFx0fVxuXHRcdGRyYWtlLmVtaXQoJ2RyYWdlbmQnLCBpdGVtKTtcblx0XHRfc291cmNlID0gX2l0ZW0gPSBfY29weSA9IF9pbml0aWFsU2libGluZyA9IF9jdXJyZW50U2libGluZyA9IF9yZW5kZXJUaW1lciA9IF9sYXN0RHJvcFRhcmdldCA9IG51bGw7XG5cdH1cblxuXHRmdW5jdGlvbiBpc0luaXRpYWxQbGFjZW1lbnQodGFyZ2V0LCBzKSB7XG5cdFx0dmFyIHNpYmxpbmc7XG5cdFx0aWYgKHMgIT09IHZvaWQgMCkge1xuXHRcdFx0c2libGluZyA9IHM7XG5cdFx0fSBlbHNlIGlmIChfbWlycm9yKSB7XG5cdFx0XHRzaWJsaW5nID0gX2N1cnJlbnRTaWJsaW5nO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRzaWJsaW5nID0gbmV4dEVsKF9jb3B5IHx8IF9pdGVtKTtcblx0XHR9XG5cdFx0cmV0dXJuIHRhcmdldCA9PT0gX3NvdXJjZSAmJiBzaWJsaW5nID09PSBfaW5pdGlhbFNpYmxpbmc7XG5cdH1cblxuXHRmdW5jdGlvbiBmaW5kRHJvcFRhcmdldChlbGVtZW50QmVoaW5kQ3Vyc29yLCBjbGllbnRYLCBjbGllbnRZKSB7XG5cdFx0dmFyIHRhcmdldCA9IGVsZW1lbnRCZWhpbmRDdXJzb3I7XG5cdFx0d2hpbGUgKHRhcmdldCAmJiAhYWNjZXB0ZWQoKSkge1xuXHRcdFx0dGFyZ2V0ID0gZ2V0UGFyZW50KHRhcmdldCk7XG5cdFx0fVxuXHRcdHJldHVybiB0YXJnZXQ7XG5cblx0XHRmdW5jdGlvbiBhY2NlcHRlZCgpIHtcblx0XHRcdHZhciBkcm9wcGFibGUgPSBpc0NvbnRhaW5lcih0YXJnZXQpO1xuXHRcdFx0aWYgKGRyb3BwYWJsZSA9PT0gZmFsc2UpIHtcblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0fVxuXG5cdFx0XHR2YXIgaW1tZWRpYXRlID0gZ2V0SW1tZWRpYXRlQ2hpbGQodGFyZ2V0LCBlbGVtZW50QmVoaW5kQ3Vyc29yKTtcblx0XHRcdHZhciByZWZlcmVuY2UgPSBnZXRSZWZlcmVuY2UodGFyZ2V0LCBpbW1lZGlhdGUsIGNsaWVudFgsIGNsaWVudFkpO1xuXHRcdFx0dmFyIGluaXRpYWwgPSBpc0luaXRpYWxQbGFjZW1lbnQodGFyZ2V0LCByZWZlcmVuY2UpO1xuXHRcdFx0aWYgKGluaXRpYWwpIHtcblx0XHRcdFx0cmV0dXJuIHRydWU7IC8vIHNob3VsZCBhbHdheXMgYmUgYWJsZSB0byBkcm9wIGl0IHJpZ2h0IGJhY2sgd2hlcmUgaXQgd2FzXG5cdFx0XHR9XG5cdFx0XHRyZXR1cm4gby5hY2NlcHRzKF9pdGVtLCB0YXJnZXQsIF9zb3VyY2UsIHJlZmVyZW5jZSk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gZHJhZyhlKSB7XG5cdFx0aWYgKCFfbWlycm9yKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGUucHJldmVudERlZmF1bHQoKTtcblxuXHRcdHZhciBjbGllbnRYID0gZ2V0Q29vcmQoJ2NsaWVudFgnLCBlKTtcblx0XHR2YXIgY2xpZW50WSA9IGdldENvb3JkKCdjbGllbnRZJywgZSk7XG5cdFx0dmFyIHggPSBjbGllbnRYIC0gX29mZnNldFg7XG5cdFx0dmFyIHkgPSBjbGllbnRZIC0gX29mZnNldFk7XG5cblx0XHRfbWlycm9yLnN0eWxlLmxlZnQgPSB4ICsgJ3B4Jztcblx0XHRfbWlycm9yLnN0eWxlLnRvcCA9IHkgKyAncHgnO1xuXG5cdFx0dmFyIGl0ZW0gPSBfY29weSB8fCBfaXRlbTtcblx0XHR2YXIgZWxlbWVudEJlaGluZEN1cnNvciA9IGdldEVsZW1lbnRCZWhpbmRQb2ludChfbWlycm9yLCBjbGllbnRYLCBjbGllbnRZKTtcblx0XHR2YXIgZHJvcFRhcmdldCA9IGZpbmREcm9wVGFyZ2V0KGVsZW1lbnRCZWhpbmRDdXJzb3IsIGNsaWVudFgsIGNsaWVudFkpO1xuXHRcdHZhciBjaGFuZ2VkID0gZHJvcFRhcmdldCAhPT0gbnVsbCAmJiBkcm9wVGFyZ2V0ICE9PSBfbGFzdERyb3BUYXJnZXQ7XG5cdFx0aWYgKGNoYW5nZWQgfHwgZHJvcFRhcmdldCA9PT0gbnVsbCkge1xuXHRcdFx0b3V0KCk7XG5cdFx0XHRfbGFzdERyb3BUYXJnZXQgPSBkcm9wVGFyZ2V0O1xuXHRcdFx0b3ZlcigpO1xuXHRcdH1cblx0XHR2YXIgcGFyZW50ID0gZ2V0UGFyZW50KGl0ZW0pO1xuXHRcdGlmIChkcm9wVGFyZ2V0ID09PSBfc291cmNlICYmIF9jb3B5ICYmICFvLmNvcHlTb3J0U291cmNlKSB7XG5cdFx0XHRpZiAocGFyZW50KSB7XG5cdFx0XHRcdHBhcmVudC5yZW1vdmVDaGlsZChpdGVtKTtcblx0XHRcdH1cblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dmFyIHJlZmVyZW5jZTtcblx0XHR2YXIgaW1tZWRpYXRlID0gZ2V0SW1tZWRpYXRlQ2hpbGQoZHJvcFRhcmdldCwgZWxlbWVudEJlaGluZEN1cnNvcik7XG5cdFx0aWYgKGltbWVkaWF0ZSAhPT0gbnVsbCkge1xuXHRcdFx0cmVmZXJlbmNlID0gZ2V0UmVmZXJlbmNlKGRyb3BUYXJnZXQsIGltbWVkaWF0ZSwgY2xpZW50WCwgY2xpZW50WSk7XG5cdFx0fSBlbHNlIGlmIChvLnJldmVydE9uU3BpbGwgPT09IHRydWUgJiYgIV9jb3B5KSB7XG5cdFx0XHRyZWZlcmVuY2UgPSBfaW5pdGlhbFNpYmxpbmc7XG5cdFx0XHRkcm9wVGFyZ2V0ID0gX3NvdXJjZTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0aWYgKF9jb3B5ICYmIHBhcmVudCkge1xuXHRcdFx0XHRwYXJlbnQucmVtb3ZlQ2hpbGQoaXRlbSk7XG5cdFx0XHR9XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGlmIChcblx0XHRcdChyZWZlcmVuY2UgPT09IG51bGwgJiYgY2hhbmdlZCkgfHxcblx0XHRcdHJlZmVyZW5jZSAhPT0gaXRlbSAmJlxuXHRcdFx0cmVmZXJlbmNlICE9PSBuZXh0RWwoaXRlbSlcblx0XHQpIHtcblx0XHRcdF9jdXJyZW50U2libGluZyA9IHJlZmVyZW5jZTtcblx0XHRcdGRyb3BUYXJnZXQuaW5zZXJ0QmVmb3JlKGl0ZW0sIHJlZmVyZW5jZSk7XG5cdFx0XHRkcmFrZS5lbWl0KCdzaGFkb3cnLCBpdGVtLCBkcm9wVGFyZ2V0LCBfc291cmNlKTtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBtb3ZlZCh0eXBlKSB7XG5cdFx0XHRkcmFrZS5lbWl0KHR5cGUsIGl0ZW0sIF9sYXN0RHJvcFRhcmdldCwgX3NvdXJjZSk7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gb3ZlcigpIHtcblx0XHRcdGlmIChjaGFuZ2VkKSB7XG5cdFx0XHRcdG1vdmVkKCdvdmVyJyk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gb3V0KCkge1xuXHRcdFx0aWYgKF9sYXN0RHJvcFRhcmdldCkge1xuXHRcdFx0XHRtb3ZlZCgnb3V0Jyk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gc3BpbGxPdmVyKGVsKSB7XG5cdFx0Y2xhc3Nlcy5ybShlbCwgJ2d1LWhpZGUnKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHNwaWxsT3V0KGVsKSB7XG5cdFx0aWYgKGRyYWtlLmRyYWdnaW5nKSB7XG5cdFx0XHRjbGFzc2VzLmFkZChlbCwgJ2d1LWhpZGUnKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiByZW5kZXJNaXJyb3JJbWFnZSgpIHtcblx0XHRpZiAoX21pcnJvcikge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdF9taXJyb3IgPSBfaXRlbS5jbG9uZU5vZGUodHJ1ZSk7XG5cblx0XHRmYXN0ZG9tLm1lYXN1cmUoZnVuY3Rpb24gKCkge1xuXHRcdFx0dmFyIHJlY3QgPSBfaXRlbS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuXHRcdFx0ZmFzdGRvbS5tdXRhdGUoZnVuY3Rpb24gKCkge1xuXHRcdFx0XHRfbWlycm9yLnN0eWxlLndpZHRoID0gZ2V0UmVjdFdpZHRoKHJlY3QpICsgJ3B4Jztcblx0XHRcdFx0X21pcnJvci5zdHlsZS5oZWlnaHQgPSBnZXRSZWN0SGVpZ2h0KHJlY3QpICsgJ3B4JztcblxuXHRcdFx0XHRjbGFzc2VzLnJtKF9taXJyb3IsICdndS10cmFuc2l0Jyk7XG5cdFx0XHRcdGNsYXNzZXMuYWRkKF9taXJyb3IsICdndS1taXJyb3InKTtcblxuXHRcdFx0XHRvLm1pcnJvckNvbnRhaW5lci5hcHBlbmRDaGlsZChfbWlycm9yKTtcblx0XHRcdFx0Y2xhc3Nlcy5hZGQoby5taXJyb3JDb250YWluZXIsICdndS11bnNlbGVjdGFibGUnKTtcblx0XHRcdH0pLnRoZW4oZnVuY3Rpb24gKCkge1xuXHRcdFx0XHR0b3VjaHkoZG9jdW1lbnRFbGVtZW50LCAnYWRkJywgJ21vdXNlbW92ZScsIGRyYWcpO1xuXHRcdFx0XHRkcmFrZS5lbWl0KCdjbG9uZWQnLCBfbWlycm9yLCBfaXRlbSwgJ21pcnJvcicpO1xuXHRcdFx0fSk7XG5cdFx0fSk7XG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmVNaXJyb3JJbWFnZSgpIHtcblx0XHRpZiAoX21pcnJvcikge1xuXHRcdFx0Y2xhc3Nlcy5ybShvLm1pcnJvckNvbnRhaW5lciwgJ2d1LXVuc2VsZWN0YWJsZScpO1xuXHRcdFx0dG91Y2h5KGRvY3VtZW50RWxlbWVudCwgJ3JlbW92ZScsICdtb3VzZW1vdmUnLCBkcmFnKTtcblx0XHRcdGdldFBhcmVudChfbWlycm9yKS5yZW1vdmVDaGlsZChfbWlycm9yKTtcblx0XHRcdF9taXJyb3IgPSBudWxsO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIGdldEltbWVkaWF0ZUNoaWxkKGRyb3BUYXJnZXQsIHRhcmdldCkge1xuXHRcdHZhciBpbW1lZGlhdGUgPSB0YXJnZXQ7XG5cdFx0d2hpbGUgKGltbWVkaWF0ZSAhPT0gZHJvcFRhcmdldCAmJiBnZXRQYXJlbnQoaW1tZWRpYXRlKSAhPT0gZHJvcFRhcmdldCkge1xuXHRcdFx0aW1tZWRpYXRlID0gZ2V0UGFyZW50KGltbWVkaWF0ZSk7XG5cdFx0fVxuXHRcdGlmIChpbW1lZGlhdGUgPT09IGRvY3VtZW50RWxlbWVudCkge1xuXHRcdFx0cmV0dXJuIG51bGw7XG5cdFx0fVxuXHRcdHJldHVybiBpbW1lZGlhdGU7XG5cdH1cblxuXHRmdW5jdGlvbiBnZXRSZWZlcmVuY2UoZHJvcFRhcmdldCwgdGFyZ2V0LCB4LCB5KSB7XG5cdFx0dmFyIGhvcml6b250YWwgPSBvLmRpcmVjdGlvbiA9PT0gJ2hvcml6b250YWwnO1xuXHRcdHZhciByZWZlcmVuY2UgPSB0YXJnZXQgIT09IGRyb3BUYXJnZXQgPyBpbnNpZGUoKSA6IG91dHNpZGUoKTtcblx0XHRyZXR1cm4gcmVmZXJlbmNlO1xuXG5cdFx0ZnVuY3Rpb24gb3V0c2lkZSgpIHsgLy8gc2xvd2VyLCBidXQgYWJsZSB0byBmaWd1cmUgb3V0IGFueSBwb3NpdGlvblxuXHRcdFx0dmFyIGxlbiA9IGRyb3BUYXJnZXQuY2hpbGRyZW4ubGVuZ3RoO1xuXHRcdFx0dmFyIGk7XG5cdFx0XHR2YXIgZWw7XG5cdFx0XHR2YXIgcmVjdDtcblx0XHRcdGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKykge1xuXHRcdFx0XHRlbCA9IGRyb3BUYXJnZXQuY2hpbGRyZW5baV07XG5cdFx0XHRcdHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblx0XHRcdFx0aWYgKGhvcml6b250YWwgJiYgKHJlY3QubGVmdCArIHJlY3Qud2lkdGggLyAyKSA+IHgpIHtcblx0XHRcdFx0XHRyZXR1cm4gZWw7XG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKCFob3Jpem9udGFsICYmIChyZWN0LnRvcCArIHJlY3QuaGVpZ2h0IC8gMikgPiB5KSB7XG5cdFx0XHRcdFx0cmV0dXJuIGVsO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRyZXR1cm4gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpbnNpZGUoKSB7IC8vIGZhc3RlciwgYnV0IG9ubHkgYXZhaWxhYmxlIGlmIGRyb3BwZWQgaW5zaWRlIGEgY2hpbGQgZWxlbWVudFxuXHRcdFx0dmFyIHJlY3QgPSB0YXJnZXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cdFx0XHRpZiAoaG9yaXpvbnRhbCkge1xuXHRcdFx0XHRyZXR1cm4gcmVzb2x2ZSh4ID4gcmVjdC5sZWZ0ICsgZ2V0UmVjdFdpZHRoKHJlY3QpIC8gMik7XG5cdFx0XHR9XG5cdFx0XHRyZXR1cm4gcmVzb2x2ZSh5ID4gcmVjdC50b3AgKyBnZXRSZWN0SGVpZ2h0KHJlY3QpIC8gMik7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gcmVzb2x2ZShhZnRlcikge1xuXHRcdFx0cmV0dXJuIGFmdGVyID8gbmV4dEVsKHRhcmdldCkgOiB0YXJnZXQ7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gaXNDb3B5KGl0ZW0sIGNvbnRhaW5lcikge1xuXHRcdHJldHVybiB0eXBlb2Ygby5jb3B5ID09PSAnYm9vbGVhbicgPyBvLmNvcHkgOiBvLmNvcHkoaXRlbSwgY29udGFpbmVyKTtcblx0fVxufVxuXG5mdW5jdGlvbiB0b3VjaHkoZWwsIG9wLCB0eXBlLCBmbikge1xuXHR2YXIgdG91Y2ggPSB7XG5cdFx0bW91c2V1cDogJ3RvdWNoZW5kJyxcblx0XHRtb3VzZWRvd246ICd0b3VjaHN0YXJ0Jyxcblx0XHRtb3VzZW1vdmU6ICd0b3VjaG1vdmUnXG5cdH07XG5cdHZhciBwb2ludGVycyA9IHtcblx0XHRtb3VzZXVwOiAncG9pbnRlcnVwJyxcblx0XHRtb3VzZWRvd246ICdwb2ludGVyZG93bicsXG5cdFx0bW91c2Vtb3ZlOiAncG9pbnRlcm1vdmUnXG5cdH07XG5cdHZhciBtaWNyb3NvZnQgPSB7XG5cdFx0bW91c2V1cDogJ01TUG9pbnRlclVwJyxcblx0XHRtb3VzZWRvd246ICdNU1BvaW50ZXJEb3duJyxcblx0XHRtb3VzZW1vdmU6ICdNU1BvaW50ZXJNb3ZlJ1xuXHR9O1xuXHRpZiAoZ2xvYmFsLm5hdmlnYXRvci5wb2ludGVyRW5hYmxlZCkge1xuXHRcdGNyb3NzdmVudFtvcF0oZWwsIHBvaW50ZXJzW3R5cGVdLCBmbik7XG5cdH0gZWxzZSBpZiAoZ2xvYmFsLm5hdmlnYXRvci5tc1BvaW50ZXJFbmFibGVkKSB7XG5cdFx0Y3Jvc3N2ZW50W29wXShlbCwgbWljcm9zb2Z0W3R5cGVdLCBmbik7XG5cdH0gZWxzZSB7XG5cdFx0Y3Jvc3N2ZW50W29wXShlbCwgdG91Y2hbdHlwZV0sIGZuKTtcblx0XHRjcm9zc3ZlbnRbb3BdKGVsLCB0eXBlLCBmbik7XG5cdH1cbn1cblxuZnVuY3Rpb24gd2hpY2hNb3VzZUJ1dHRvbihlKSB7XG5cdGlmIChlLnRvdWNoZXMgIT09IHZvaWQgMCkge1xuXHRcdHJldHVybiBlLnRvdWNoZXMubGVuZ3RoO1xuXHR9XG5cdGlmIChlLndoaWNoICE9PSB2b2lkIDAgJiYgZS53aGljaCAhPT0gMCkge1xuXHRcdHJldHVybiBlLndoaWNoO1xuXHR9IC8vIHNlZSBodHRwczovL2dpdGh1Yi5jb20vYmV2YWNxdWEvZHJhZ3VsYS9pc3N1ZXMvMjYxXG5cdGlmIChlLmJ1dHRvbnMgIT09IHZvaWQgMCkge1xuXHRcdHJldHVybiBlLmJ1dHRvbnM7XG5cdH1cblx0dmFyIGJ1dHRvbiA9IGUuYnV0dG9uO1xuXHRpZiAoYnV0dG9uICE9PSB2b2lkIDApIHsgLy8gc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9qcXVlcnkvanF1ZXJ5L2Jsb2IvOTllOGZmMWJhYTdhZTM0MWU5NGJiODljM2U4NDU3MGM3YzNhZDllYS9zcmMvZXZlbnQuanMjTDU3My1MNTc1XG5cdFx0cmV0dXJuIGJ1dHRvbiAmIDEgPyAxIDogYnV0dG9uICYgMiA/IDMgOiAoYnV0dG9uICYgNCA/IDIgOiAwKTtcblx0fVxufVxuXG5mdW5jdGlvbiBnZXRPZmZzZXQoZWwpIHtcblx0dmFyIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblx0cmV0dXJuIHtcblx0XHRsZWZ0OiByZWN0LmxlZnQgKyBnZXRTY3JvbGwoJ3Njcm9sbExlZnQnLCAncGFnZVhPZmZzZXQnKSxcblx0XHR0b3A6IHJlY3QudG9wICsgZ2V0U2Nyb2xsKCdzY3JvbGxUb3AnLCAncGFnZVlPZmZzZXQnKVxuXHR9O1xufVxuXG5mdW5jdGlvbiBnZXRTY3JvbGwoc2Nyb2xsUHJvcCwgb2Zmc2V0UHJvcCkge1xuXHRpZiAodHlwZW9mIGdsb2JhbFtvZmZzZXRQcm9wXSAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRyZXR1cm4gZ2xvYmFsW29mZnNldFByb3BdO1xuXHR9XG5cdGlmIChkb2N1bWVudEVsZW1lbnQuY2xpZW50SGVpZ2h0KSB7XG5cdFx0cmV0dXJuIGRvY3VtZW50RWxlbWVudFtzY3JvbGxQcm9wXTtcblx0fVxuXHRyZXR1cm4gZG9jLmJvZHlbc2Nyb2xsUHJvcF07XG59XG5cbmZ1bmN0aW9uIGdldEVsZW1lbnRCZWhpbmRQb2ludChwb2ludCwgeCwgeSkge1xuXHR2YXIgcCA9IHBvaW50IHx8IHt9O1xuXHR2YXIgc3RhdGUgPSBwLmNsYXNzTmFtZTtcblx0dmFyIGVsO1xuXHRwLmNsYXNzTmFtZSArPSAnIGd1LWhpZGUnO1xuXHRlbCA9IGRvYy5lbGVtZW50RnJvbVBvaW50KHgsIHkpO1xuXHRwLmNsYXNzTmFtZSA9IHN0YXRlO1xuXHRyZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIG5ldmVyKCkge1xuXHRyZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGFsd2F5cygpIHtcblx0cmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGdldFJlY3RXaWR0aChyZWN0KSB7XG5cdHJldHVybiByZWN0LndpZHRoIHx8IChyZWN0LnJpZ2h0IC0gcmVjdC5sZWZ0KTtcbn1cblxuZnVuY3Rpb24gZ2V0UmVjdEhlaWdodChyZWN0KSB7XG5cdHJldHVybiByZWN0LmhlaWdodCB8fCAocmVjdC5ib3R0b20gLSByZWN0LnRvcCk7XG59XG5cbmZ1bmN0aW9uIGdldFBhcmVudChlbCkge1xuXHRyZXR1cm4gZWwucGFyZW50Tm9kZSA9PT0gZG9jID8gbnVsbCA6IGVsLnBhcmVudE5vZGU7XG59XG5cbmZ1bmN0aW9uIGlzSW5wdXQoZWwpIHtcblx0cmV0dXJuIGVsLnRhZ05hbWUgPT09ICdJTlBVVCcgfHwgZWwudGFnTmFtZSA9PT0gJ1RFWFRBUkVBJyB8fCBlbC50YWdOYW1lID09PSAnU0VMRUNUJyB8fCBpc0VkaXRhYmxlKGVsKTtcbn1cblxuZnVuY3Rpb24gaXNFZGl0YWJsZShlbCkge1xuXHRpZiAoIWVsKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9IC8vIG5vIHBhcmVudHMgd2VyZSBlZGl0YWJsZVxuXHRpZiAoZWwuY29udGVudEVkaXRhYmxlID09PSAnZmFsc2UnKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9IC8vIHN0b3AgdGhlIGxvb2t1cFxuXHRpZiAoZWwuY29udGVudEVkaXRhYmxlID09PSAndHJ1ZScpIHtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSAvLyBmb3VuZCBhIGNvbnRlbnRFZGl0YWJsZSBlbGVtZW50IGluIHRoZSBjaGFpblxuXHRyZXR1cm4gaXNFZGl0YWJsZShnZXRQYXJlbnQoZWwpKTsgLy8gY29udGVudEVkaXRhYmxlIGlzIHNldCB0byAnaW5oZXJpdCdcbn1cblxuZnVuY3Rpb24gbmV4dEVsKGVsKSB7XG5cdHJldHVybiBlbC5uZXh0RWxlbWVudFNpYmxpbmcgfHwgbWFudWFsbHkoKTtcblxuXHRmdW5jdGlvbiBtYW51YWxseSgpIHtcblx0XHR2YXIgc2libGluZyA9IGVsO1xuXHRcdGRvIHtcblx0XHRcdHNpYmxpbmcgPSBzaWJsaW5nLm5leHRTaWJsaW5nO1xuXHRcdH0gd2hpbGUgKHNpYmxpbmcgJiYgc2libGluZy5ub2RlVHlwZSAhPT0gMSk7XG5cdFx0cmV0dXJuIHNpYmxpbmc7XG5cdH1cbn1cblxuZnVuY3Rpb24gZ2V0RXZlbnRIb3N0KGUpIHtcblx0Ly8gb24gdG91Y2hlbmQgZXZlbnQsIHdlIGhhdmUgdG8gdXNlIGBlLmNoYW5nZWRUb3VjaGVzYFxuXHQvLyBzZWUgaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy83MTkyNTYzL3RvdWNoZW5kLWV2ZW50LXByb3BlcnRpZXNcblx0Ly8gc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9iZXZhY3F1YS9kcmFndWxhL2lzc3Vlcy8zNFxuXHRpZiAoZS50YXJnZXRUb3VjaGVzICYmIGUudGFyZ2V0VG91Y2hlcy5sZW5ndGgpIHtcblx0XHRyZXR1cm4gZS50YXJnZXRUb3VjaGVzWzBdO1xuXHR9XG5cdGlmIChlLmNoYW5nZWRUb3VjaGVzICYmIGUuY2hhbmdlZFRvdWNoZXMubGVuZ3RoKSB7XG5cdFx0cmV0dXJuIGUuY2hhbmdlZFRvdWNoZXNbMF07XG5cdH1cblx0cmV0dXJuIGU7XG59XG5cbmZ1bmN0aW9uIGdldENvb3JkKGNvb3JkLCBlKSB7XG5cdHZhciBob3N0ID0gZ2V0RXZlbnRIb3N0KGUpO1xuXHR2YXIgbWlzc01hcCA9IHtcblx0XHRwYWdlWDogJ2NsaWVudFgnLCAvLyBJRThcblx0XHRwYWdlWTogJ2NsaWVudFknIC8vIElFOFxuXHR9O1xuXHRpZiAoY29vcmQgaW4gbWlzc01hcCAmJiAhKGNvb3JkIGluIGhvc3QpICYmIG1pc3NNYXBbY29vcmRdIGluIGhvc3QpIHtcblx0XHRjb29yZCA9IG1pc3NNYXBbY29vcmRdO1xuXHR9XG5cdHJldHVybiBob3N0W2Nvb3JkXTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBkcmFndWxhO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBhdG9hIChhLCBuKSB7IHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhLCBuKTsgfVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdGlja3kgPSByZXF1aXJlKCd0aWNreScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGRlYm91bmNlIChmbiwgYXJncywgY3R4KSB7XG4gIGlmICghZm4pIHsgcmV0dXJuOyB9XG4gIHRpY2t5KGZ1bmN0aW9uIHJ1biAoKSB7XG4gICAgZm4uYXBwbHkoY3R4IHx8IG51bGwsIGFyZ3MgfHwgW10pO1xuICB9KTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBhdG9hID0gcmVxdWlyZSgnYXRvYScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi9kZWJvdW5jZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGVtaXR0ZXIgKHRoaW5nLCBvcHRpb25zKSB7XG4gIHZhciBvcHRzID0gb3B0aW9ucyB8fCB7fTtcbiAgdmFyIGV2dCA9IHt9O1xuICBpZiAodGhpbmcgPT09IHVuZGVmaW5lZCkgeyB0aGluZyA9IHt9OyB9XG4gIHRoaW5nLm9uID0gZnVuY3Rpb24gKHR5cGUsIGZuKSB7XG4gICAgaWYgKCFldnRbdHlwZV0pIHtcbiAgICAgIGV2dFt0eXBlXSA9IFtmbl07XG4gICAgfSBlbHNlIHtcbiAgICAgIGV2dFt0eXBlXS5wdXNoKGZuKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaW5nO1xuICB9O1xuICB0aGluZy5vbmNlID0gZnVuY3Rpb24gKHR5cGUsIGZuKSB7XG4gICAgZm4uX29uY2UgPSB0cnVlOyAvLyB0aGluZy5vZmYoZm4pIHN0aWxsIHdvcmtzIVxuICAgIHRoaW5nLm9uKHR5cGUsIGZuKTtcbiAgICByZXR1cm4gdGhpbmc7XG4gIH07XG4gIHRoaW5nLm9mZiA9IGZ1bmN0aW9uICh0eXBlLCBmbikge1xuICAgIHZhciBjID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICBpZiAoYyA9PT0gMSkge1xuICAgICAgZGVsZXRlIGV2dFt0eXBlXTtcbiAgICB9IGVsc2UgaWYgKGMgPT09IDApIHtcbiAgICAgIGV2dCA9IHt9O1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgZXQgPSBldnRbdHlwZV07XG4gICAgICBpZiAoIWV0KSB7IHJldHVybiB0aGluZzsgfVxuICAgICAgZXQuc3BsaWNlKGV0LmluZGV4T2YoZm4pLCAxKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaW5nO1xuICB9O1xuICB0aGluZy5lbWl0ID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBhcmdzID0gYXRvYShhcmd1bWVudHMpO1xuICAgIHJldHVybiB0aGluZy5lbWl0dGVyU25hcHNob3QoYXJncy5zaGlmdCgpKS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfTtcbiAgdGhpbmcuZW1pdHRlclNuYXBzaG90ID0gZnVuY3Rpb24gKHR5cGUpIHtcbiAgICB2YXIgZXQgPSAoZXZ0W3R5cGVdIHx8IFtdKS5zbGljZSgwKTtcbiAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIGFyZ3MgPSBhdG9hKGFyZ3VtZW50cyk7XG4gICAgICB2YXIgY3R4ID0gdGhpcyB8fCB0aGluZztcbiAgICAgIGlmICh0eXBlID09PSAnZXJyb3InICYmIG9wdHMudGhyb3dzICE9PSBmYWxzZSAmJiAhZXQubGVuZ3RoKSB7IHRocm93IGFyZ3MubGVuZ3RoID09PSAxID8gYXJnc1swXSA6IGFyZ3M7IH1cbiAgICAgIGV0LmZvckVhY2goZnVuY3Rpb24gZW1pdHRlciAobGlzdGVuKSB7XG4gICAgICAgIGlmIChvcHRzLmFzeW5jKSB7IGRlYm91bmNlKGxpc3RlbiwgYXJncywgY3R4KTsgfSBlbHNlIHsgbGlzdGVuLmFwcGx5KGN0eCwgYXJncyk7IH1cbiAgICAgICAgaWYgKGxpc3Rlbi5fb25jZSkgeyB0aGluZy5vZmYodHlwZSwgbGlzdGVuKTsgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gdGhpbmc7XG4gICAgfTtcbiAgfTtcbiAgcmV0dXJuIHRoaW5nO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGN1c3RvbUV2ZW50ID0gcmVxdWlyZSgnY3VzdG9tLWV2ZW50Jyk7XG52YXIgZXZlbnRtYXAgPSByZXF1aXJlKCcuL2V2ZW50bWFwJyk7XG52YXIgZG9jID0gZ2xvYmFsLmRvY3VtZW50O1xudmFyIGFkZEV2ZW50ID0gYWRkRXZlbnRFYXN5O1xudmFyIHJlbW92ZUV2ZW50ID0gcmVtb3ZlRXZlbnRFYXN5O1xudmFyIGhhcmRDYWNoZSA9IFtdO1xuXG5pZiAoIWdsb2JhbC5hZGRFdmVudExpc3RlbmVyKSB7XG4gIGFkZEV2ZW50ID0gYWRkRXZlbnRIYXJkO1xuICByZW1vdmVFdmVudCA9IHJlbW92ZUV2ZW50SGFyZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGFkZDogYWRkRXZlbnQsXG4gIHJlbW92ZTogcmVtb3ZlRXZlbnQsXG4gIGZhYnJpY2F0ZTogZmFicmljYXRlRXZlbnRcbn07XG5cbmZ1bmN0aW9uIGFkZEV2ZW50RWFzeSAoZWwsIHR5cGUsIGZuLCBjYXB0dXJpbmcpIHtcbiAgcmV0dXJuIGVsLmFkZEV2ZW50TGlzdGVuZXIodHlwZSwgZm4sIGNhcHR1cmluZyk7XG59XG5cbmZ1bmN0aW9uIGFkZEV2ZW50SGFyZCAoZWwsIHR5cGUsIGZuKSB7XG4gIHJldHVybiBlbC5hdHRhY2hFdmVudCgnb24nICsgdHlwZSwgd3JhcChlbCwgdHlwZSwgZm4pKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlRXZlbnRFYXN5IChlbCwgdHlwZSwgZm4sIGNhcHR1cmluZykge1xuICByZXR1cm4gZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcih0eXBlLCBmbiwgY2FwdHVyaW5nKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlRXZlbnRIYXJkIChlbCwgdHlwZSwgZm4pIHtcbiAgdmFyIGxpc3RlbmVyID0gdW53cmFwKGVsLCB0eXBlLCBmbik7XG4gIGlmIChsaXN0ZW5lcikge1xuICAgIHJldHVybiBlbC5kZXRhY2hFdmVudCgnb24nICsgdHlwZSwgbGlzdGVuZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGZhYnJpY2F0ZUV2ZW50IChlbCwgdHlwZSwgbW9kZWwpIHtcbiAgdmFyIGUgPSBldmVudG1hcC5pbmRleE9mKHR5cGUpID09PSAtMSA/IG1ha2VDdXN0b21FdmVudCgpIDogbWFrZUNsYXNzaWNFdmVudCgpO1xuICBpZiAoZWwuZGlzcGF0Y2hFdmVudCkge1xuICAgIGVsLmRpc3BhdGNoRXZlbnQoZSk7XG4gIH0gZWxzZSB7XG4gICAgZWwuZmlyZUV2ZW50KCdvbicgKyB0eXBlLCBlKTtcbiAgfVxuICBmdW5jdGlvbiBtYWtlQ2xhc3NpY0V2ZW50ICgpIHtcbiAgICB2YXIgZTtcbiAgICBpZiAoZG9jLmNyZWF0ZUV2ZW50KSB7XG4gICAgICBlID0gZG9jLmNyZWF0ZUV2ZW50KCdFdmVudCcpO1xuICAgICAgZS5pbml0RXZlbnQodHlwZSwgdHJ1ZSwgdHJ1ZSk7XG4gICAgfSBlbHNlIGlmIChkb2MuY3JlYXRlRXZlbnRPYmplY3QpIHtcbiAgICAgIGUgPSBkb2MuY3JlYXRlRXZlbnRPYmplY3QoKTtcbiAgICB9XG4gICAgcmV0dXJuIGU7XG4gIH1cbiAgZnVuY3Rpb24gbWFrZUN1c3RvbUV2ZW50ICgpIHtcbiAgICByZXR1cm4gbmV3IGN1c3RvbUV2ZW50KHR5cGUsIHsgZGV0YWlsOiBtb2RlbCB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiB3cmFwcGVyRmFjdG9yeSAoZWwsIHR5cGUsIGZuKSB7XG4gIHJldHVybiBmdW5jdGlvbiB3cmFwcGVyIChvcmlnaW5hbEV2ZW50KSB7XG4gICAgdmFyIGUgPSBvcmlnaW5hbEV2ZW50IHx8IGdsb2JhbC5ldmVudDtcbiAgICBlLnRhcmdldCA9IGUudGFyZ2V0IHx8IGUuc3JjRWxlbWVudDtcbiAgICBlLnByZXZlbnREZWZhdWx0ID0gZS5wcmV2ZW50RGVmYXVsdCB8fCBmdW5jdGlvbiBwcmV2ZW50RGVmYXVsdCAoKSB7IGUucmV0dXJuVmFsdWUgPSBmYWxzZTsgfTtcbiAgICBlLnN0b3BQcm9wYWdhdGlvbiA9IGUuc3RvcFByb3BhZ2F0aW9uIHx8IGZ1bmN0aW9uIHN0b3BQcm9wYWdhdGlvbiAoKSB7IGUuY2FuY2VsQnViYmxlID0gdHJ1ZTsgfTtcbiAgICBlLndoaWNoID0gZS53aGljaCB8fCBlLmtleUNvZGU7XG4gICAgZm4uY2FsbChlbCwgZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHdyYXAgKGVsLCB0eXBlLCBmbikge1xuICB2YXIgd3JhcHBlciA9IHVud3JhcChlbCwgdHlwZSwgZm4pIHx8IHdyYXBwZXJGYWN0b3J5KGVsLCB0eXBlLCBmbik7XG4gIGhhcmRDYWNoZS5wdXNoKHtcbiAgICB3cmFwcGVyOiB3cmFwcGVyLFxuICAgIGVsZW1lbnQ6IGVsLFxuICAgIHR5cGU6IHR5cGUsXG4gICAgZm46IGZuXG4gIH0pO1xuICByZXR1cm4gd3JhcHBlcjtcbn1cblxuZnVuY3Rpb24gdW53cmFwIChlbCwgdHlwZSwgZm4pIHtcbiAgdmFyIGkgPSBmaW5kKGVsLCB0eXBlLCBmbik7XG4gIGlmIChpKSB7XG4gICAgdmFyIHdyYXBwZXIgPSBoYXJkQ2FjaGVbaV0ud3JhcHBlcjtcbiAgICBoYXJkQ2FjaGUuc3BsaWNlKGksIDEpOyAvLyBmcmVlIHVwIGEgdGFkIG9mIG1lbW9yeVxuICAgIHJldHVybiB3cmFwcGVyO1xuICB9XG59XG5cbmZ1bmN0aW9uIGZpbmQgKGVsLCB0eXBlLCBmbikge1xuICB2YXIgaSwgaXRlbTtcbiAgZm9yIChpID0gMDsgaSA8IGhhcmRDYWNoZS5sZW5ndGg7IGkrKykge1xuICAgIGl0ZW0gPSBoYXJkQ2FjaGVbaV07XG4gICAgaWYgKGl0ZW0uZWxlbWVudCA9PT0gZWwgJiYgaXRlbS50eXBlID09PSB0eXBlICYmIGl0ZW0uZm4gPT09IGZuKSB7XG4gICAgICByZXR1cm4gaTtcbiAgICB9XG4gIH1cbn1cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV2ZW50bWFwID0gW107XG52YXIgZXZlbnRuYW1lID0gJyc7XG52YXIgcm9uID0gL15vbi87XG5cbmZvciAoZXZlbnRuYW1lIGluIGdsb2JhbCkge1xuICBpZiAocm9uLnRlc3QoZXZlbnRuYW1lKSkge1xuICAgIGV2ZW50bWFwLnB1c2goZXZlbnRuYW1lLnNsaWNlKDIpKTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGV2ZW50bWFwO1xuIiwiXG52YXIgTmF0aXZlQ3VzdG9tRXZlbnQgPSBnbG9iYWwuQ3VzdG9tRXZlbnQ7XG5cbmZ1bmN0aW9uIHVzZU5hdGl2ZSAoKSB7XG4gIHRyeSB7XG4gICAgdmFyIHAgPSBuZXcgTmF0aXZlQ3VzdG9tRXZlbnQoJ2NhdCcsIHsgZGV0YWlsOiB7IGZvbzogJ2JhcicgfSB9KTtcbiAgICByZXR1cm4gICdjYXQnID09PSBwLnR5cGUgJiYgJ2JhcicgPT09IHAuZGV0YWlsLmZvbztcbiAgfSBjYXRjaCAoZSkge1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBDcm9zcy1icm93c2VyIGBDdXN0b21FdmVudGAgY29uc3RydWN0b3IuXG4gKlxuICogaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL0N1c3RvbUV2ZW50LkN1c3RvbUV2ZW50XG4gKlxuICogQHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gdXNlTmF0aXZlKCkgPyBOYXRpdmVDdXN0b21FdmVudCA6XG5cbi8vIElFID49IDlcbidmdW5jdGlvbicgPT09IHR5cGVvZiBkb2N1bWVudC5jcmVhdGVFdmVudCA/IGZ1bmN0aW9uIEN1c3RvbUV2ZW50ICh0eXBlLCBwYXJhbXMpIHtcbiAgdmFyIGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnQ3VzdG9tRXZlbnQnKTtcbiAgaWYgKHBhcmFtcykge1xuICAgIGUuaW5pdEN1c3RvbUV2ZW50KHR5cGUsIHBhcmFtcy5idWJibGVzLCBwYXJhbXMuY2FuY2VsYWJsZSwgcGFyYW1zLmRldGFpbCk7XG4gIH0gZWxzZSB7XG4gICAgZS5pbml0Q3VzdG9tRXZlbnQodHlwZSwgZmFsc2UsIGZhbHNlLCB2b2lkIDApO1xuICB9XG4gIHJldHVybiBlO1xufSA6XG5cbi8vIElFIDw9IDhcbmZ1bmN0aW9uIEN1c3RvbUV2ZW50ICh0eXBlLCBwYXJhbXMpIHtcbiAgdmFyIGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudE9iamVjdCgpO1xuICBlLnR5cGUgPSB0eXBlO1xuICBpZiAocGFyYW1zKSB7XG4gICAgZS5idWJibGVzID0gQm9vbGVhbihwYXJhbXMuYnViYmxlcyk7XG4gICAgZS5jYW5jZWxhYmxlID0gQm9vbGVhbihwYXJhbXMuY2FuY2VsYWJsZSk7XG4gICAgZS5kZXRhaWwgPSBwYXJhbXMuZGV0YWlsO1xuICB9IGVsc2Uge1xuICAgIGUuYnViYmxlcyA9IGZhbHNlO1xuICAgIGUuY2FuY2VsYWJsZSA9IGZhbHNlO1xuICAgIGUuZGV0YWlsID0gdm9pZCAwO1xuICB9XG4gIHJldHVybiBlO1xufVxuIiwiIShmdW5jdGlvbigpIHtcblxuLyoqXG4gKiBXcmFwcyBmYXN0ZG9tIGluIGEgUHJvbWlzZSBBUElcbiAqIGZvciBpbXByb3ZlZCBjb250cm9sLWZsb3cuXG4gKlxuICogQGV4YW1wbGVcbiAqXG4gKiAvLyByZXR1cm5pbmcgYSByZXN1bHRcbiAqIGZhc3Rkb20ubWVhc3VyZSgoKSA9PiBlbC5jbGllbnRXaWR0aClcbiAqICAgLnRoZW4ocmVzdWx0ID0+IC4uLik7XG4gKlxuICogLy8gcmV0dXJuaW5nIHByb21pc2VzIGZyb20gdGFza3NcbiAqIGZhc3Rkb20ubWVhc3VyZSgoKSA9PiB7XG4gKiAgIHZhciB3ID0gZWwxLmNsaWVudFdpZHRoO1xuICogICByZXR1cm4gZmFzdGRvbS5tdXRhdGUoKCkgPT4gZWwyLnN0eWxlLndpZHRoID0gdyArICdweCcpO1xuICogfSkudGhlbigoKSA9PiBjb25zb2xlLmxvZygnYWxsIGRvbmUnKSk7XG4gKlxuICogLy8gY2xlYXJpbmcgcGVuZGluZyB0YXNrc1xuICogdmFyIHByb21pc2UgPSBmYXN0ZG9tLm1lYXN1cmUoLi4uKVxuICogZmFzdGRvbS5jbGVhcihwcm9taXNlKTtcbiAqXG4gKiBAdHlwZSB7T2JqZWN0fVxuICovXG52YXIgZXhwb3J0cyA9IHtcbiAgaW5pdGlhbGl6ZTogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5fdGFza3MgPSBuZXcgTWFwKCk7XG4gIH0sXG5cbiAgbXV0YXRlOiBmdW5jdGlvbihmbiwgY3R4KSB7XG4gICAgcmV0dXJuIGNyZWF0ZSh0aGlzLCAnbXV0YXRlJywgZm4sIGN0eCk7XG4gIH0sXG5cbiAgbWVhc3VyZTogZnVuY3Rpb24oZm4sIGN0eCkge1xuICAgIHJldHVybiBjcmVhdGUodGhpcywgJ21lYXN1cmUnLCBmbiwgY3R4KTtcbiAgfSxcblxuICBjbGVhcjogZnVuY3Rpb24ocHJvbWlzZSkge1xuICAgIHZhciB0YXNrcyA9IHRoaXMuX3Rhc2tzO1xuICAgIHZhciB0YXNrID0gdGFza3MuZ2V0KHByb21pc2UpO1xuICAgIHRoaXMuZmFzdGRvbS5jbGVhcih0YXNrKTtcbiAgICB0YXNrcy5kZWxldGUodGFzayk7XG4gIH1cbn07XG5cbi8qKlxuICogQ3JlYXRlIGEgZmFzdGRvbSB0YXNrIHdyYXBwZWQgaW5cbiAqIGEgJ2NhbmNlbGxhYmxlJyBQcm9taXNlLlxuICpcbiAqIEBwYXJhbSAge0Zhc3REb219ICBmYXN0ZG9tXG4gKiBAcGFyYW0gIHtTdHJpbmd9ICAgdHlwZSAtICdtZWFzdXJlJ3wnbXVhdGF0ZSdcbiAqIEBwYXJhbSAge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UHJvbWlzZX1cbiAqL1xuZnVuY3Rpb24gY3JlYXRlKHByb21pc2VkLCB0eXBlLCBmbiwgY3R4KSB7XG4gIHZhciB0YXNrcyA9IHByb21pc2VkLl90YXNrcztcbiAgdmFyIGZhc3Rkb20gPSBwcm9taXNlZC5mYXN0ZG9tO1xuICB2YXIgdGFzaztcblxuICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgIHRhc2sgPSBmYXN0ZG9tW3R5cGVdKGZ1bmN0aW9uKCkge1xuICAgICAgdGFza3MuZGVsZXRlKHByb21pc2UpO1xuICAgICAgdHJ5IHsgcmVzb2x2ZShjdHggPyBmbi5jYWxsKGN0eCkgOiBmbigpKTsgfVxuICAgICAgY2F0Y2ggKGUpIHsgcmVqZWN0KGUpOyB9XG4gICAgfSwgY3R4KTtcbiAgfSk7XG5cbiAgdGFza3Muc2V0KHByb21pc2UsIHRhc2spO1xuICByZXR1cm4gcHJvbWlzZTtcbn1cblxuLy8gRXhwb3NlIHRvIENKUywgQU1EIG9yIGdsb2JhbFxuaWYgKCh0eXBlb2YgZGVmaW5lKVswXSA9PSAnZicpIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIGV4cG9ydHM7IH0pO1xuZWxzZSBpZiAoKHR5cGVvZiBtb2R1bGUpWzBdID09ICdvJykgbW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzO1xuZWxzZSB3aW5kb3cuZmFzdGRvbVByb21pc2VkID0gZXhwb3J0cztcblxufSkoKTsiLCIhKGZ1bmN0aW9uKHdpbikge1xuXG4vKipcbiAqIEZhc3REb21cbiAqXG4gKiBFbGltaW5hdGVzIGxheW91dCB0aHJhc2hpbmdcbiAqIGJ5IGJhdGNoaW5nIERPTSByZWFkL3dyaXRlXG4gKiBpbnRlcmFjdGlvbnMuXG4gKlxuICogQGF1dGhvciBXaWxzb24gUGFnZSA8d2lsc29ucGFnZUBtZS5jb20+XG4gKiBAYXV0aG9yIEtvcm5lbCBMZXNpbnNraSA8a29ybmVsLmxlc2luc2tpQGZ0LmNvbT5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbi8qKlxuICogTWluaSBsb2dnZXJcbiAqXG4gKiBAcmV0dXJuIHtGdW5jdGlvbn1cbiAqL1xudmFyIGRlYnVnID0gMCA/IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSwgJ1tmYXN0ZG9tXScpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBOb3JtYWxpemVkIHJBRlxuICpcbiAqIEB0eXBlIHtGdW5jdGlvbn1cbiAqL1xudmFyIHJhZiA9IHdpbi5yZXF1ZXN0QW5pbWF0aW9uRnJhbWVcbiAgfHwgd2luLndlYmtpdFJlcXVlc3RBbmltYXRpb25GcmFtZVxuICB8fCB3aW4ubW96UmVxdWVzdEFuaW1hdGlvbkZyYW1lXG4gIHx8IHdpbi5tc1JlcXVlc3RBbmltYXRpb25GcmFtZVxuICB8fCBmdW5jdGlvbihjYikgeyByZXR1cm4gc2V0VGltZW91dChjYiwgMTYpOyB9O1xuXG4vKipcbiAqIEluaXRpYWxpemUgYSBgRmFzdERvbWAuXG4gKlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIEZhc3REb20oKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5yZWFkcyA9IFtdO1xuICBzZWxmLndyaXRlcyA9IFtdO1xuICBzZWxmLnJhZiA9IHJhZi5iaW5kKHdpbik7IC8vIHRlc3QgaG9va1xuICBkZWJ1ZygnaW5pdGlhbGl6ZWQnLCBzZWxmKTtcbn1cblxuRmFzdERvbS5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBGYXN0RG9tLFxuXG4gIC8qKlxuICAgKiBBZGRzIGEgam9iIHRvIHRoZSByZWFkIGJhdGNoIGFuZFxuICAgKiBzY2hlZHVsZXMgYSBuZXcgZnJhbWUgaWYgbmVlZCBiZS5cbiAgICpcbiAgICogQHBhcmFtICB7RnVuY3Rpb259IGZuXG4gICAqIEBwdWJsaWNcbiAgICovXG4gIG1lYXN1cmU6IGZ1bmN0aW9uKGZuLCBjdHgpIHtcbiAgICBkZWJ1ZygnbWVhc3VyZScpO1xuICAgIHZhciB0YXNrID0gIWN0eCA/IGZuIDogZm4uYmluZChjdHgpO1xuICAgIHRoaXMucmVhZHMucHVzaCh0YXNrKTtcbiAgICBzY2hlZHVsZUZsdXNoKHRoaXMpO1xuICAgIHJldHVybiB0YXNrO1xuICB9LFxuXG4gIC8qKlxuICAgKiBBZGRzIGEgam9iIHRvIHRoZVxuICAgKiB3cml0ZSBiYXRjaCBhbmQgc2NoZWR1bGVzXG4gICAqIGEgbmV3IGZyYW1lIGlmIG5lZWQgYmUuXG4gICAqXG4gICAqIEBwYXJhbSAge0Z1bmN0aW9ufSBmblxuICAgKiBAcHVibGljXG4gICAqL1xuICBtdXRhdGU6IGZ1bmN0aW9uKGZuLCBjdHgpIHtcbiAgICBkZWJ1ZygnbXV0YXRlJyk7XG4gICAgdmFyIHRhc2sgPSAhY3R4ID8gZm4gOiBmbi5iaW5kKGN0eCk7XG4gICAgdGhpcy53cml0ZXMucHVzaCh0YXNrKTtcbiAgICBzY2hlZHVsZUZsdXNoKHRoaXMpO1xuICAgIHJldHVybiB0YXNrO1xuICB9LFxuXG4gIC8qKlxuICAgKiBDbGVhcnMgYSBzY2hlZHVsZWQgJ3JlYWQnIG9yICd3cml0ZScgdGFzay5cbiAgICpcbiAgICogQHBhcmFtIHtPYmplY3R9IHRhc2tcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gc3VjY2Vzc1xuICAgKiBAcHVibGljXG4gICAqL1xuICBjbGVhcjogZnVuY3Rpb24odGFzaykge1xuICAgIGRlYnVnKCdjbGVhcicsIHRhc2spO1xuICAgIHJldHVybiByZW1vdmUodGhpcy5yZWFkcywgdGFzaykgfHwgcmVtb3ZlKHRoaXMud3JpdGVzLCB0YXNrKTtcbiAgfSxcblxuICAvKipcbiAgICogRXh0ZW5kIHRoaXMgRmFzdERvbSB3aXRoIHNvbWVcbiAgICogY3VzdG9tIGZ1bmN0aW9uYWxpdHkuXG4gICAqXG4gICAqIEJlY2F1c2UgZmFzdGRvbSBtdXN0ICphbHdheXMqIGJlIGFcbiAgICogc2luZ2xldG9uLCB3ZSdyZSBhY3R1YWxseSBleHRlbmRpbmdcbiAgICogdGhlIGZhc3Rkb20gaW5zdGFuY2UuIFRoaXMgbWVhbnMgdGFza3NcbiAgICogc2NoZWR1bGVkIGJ5IGFuIGV4dGVuc2lvbiBzdGlsbCBlbnRlclxuICAgKiBmYXN0ZG9tJ3MgZ2xvYmFsIHRhc2sgcXVldWUuXG4gICAqXG4gICAqIFRoZSAnc3VwZXInIGluc3RhbmNlIGNhbiBiZSBhY2Nlc3NlZFxuICAgKiBmcm9tIGB0aGlzLmZhc3Rkb21gLlxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKlxuICAgKiB2YXIgbXlGYXN0ZG9tID0gZmFzdGRvbS5leHRlbmQoe1xuICAgKiAgIGluaXRpYWxpemU6IGZ1bmN0aW9uKCkge1xuICAgKiAgICAgLy8gcnVucyBvbiBjcmVhdGlvblxuICAgKiAgIH0sXG4gICAqXG4gICAqICAgLy8gb3ZlcnJpZGUgYSBtZXRob2RcbiAgICogICBtZWFzdXJlOiBmdW5jdGlvbihmbikge1xuICAgKiAgICAgLy8gZG8gZXh0cmEgc3R1ZmYgLi4uXG4gICAqXG4gICAqICAgICAvLyB0aGVuIGNhbGwgdGhlIG9yaWdpbmFsXG4gICAqICAgICByZXR1cm4gdGhpcy5mYXN0ZG9tLm1lYXN1cmUoZm4pO1xuICAgKiAgIH0sXG4gICAqXG4gICAqICAgLi4uXG4gICAqIH0pO1xuICAgKlxuICAgKiBAcGFyYW0gIHtPYmplY3R9IHByb3BzICBwcm9wZXJ0aWVzIHRvIG1peGluXG4gICAqIEByZXR1cm4ge0Zhc3REb219XG4gICAqL1xuICBleHRlbmQ6IGZ1bmN0aW9uKHByb3BzKSB7XG4gICAgZGVidWcoJ2V4dGVuZCcsIHByb3BzKTtcbiAgICBpZiAodHlwZW9mIHByb3BzICE9ICdvYmplY3QnKSB0aHJvdyBuZXcgRXJyb3IoJ2V4cGVjdGVkIG9iamVjdCcpO1xuXG4gICAgdmFyIGNoaWxkID0gT2JqZWN0LmNyZWF0ZSh0aGlzKTtcbiAgICBtaXhpbihjaGlsZCwgcHJvcHMpO1xuICAgIGNoaWxkLmZhc3Rkb20gPSB0aGlzO1xuXG4gICAgLy8gcnVuIG9wdGlvbmFsIGNyZWF0aW9uIGhvb2tcbiAgICBpZiAoY2hpbGQuaW5pdGlhbGl6ZSkgY2hpbGQuaW5pdGlhbGl6ZSgpO1xuXG4gICAgcmV0dXJuIGNoaWxkO1xuICB9LFxuXG4gIC8vIG92ZXJyaWRlIHRoaXMgd2l0aCBhIGZ1bmN0aW9uXG4gIC8vIHRvIHByZXZlbnQgRXJyb3JzIGluIGNvbnNvbGVcbiAgLy8gd2hlbiB0YXNrcyB0aHJvd1xuICBjYXRjaDogbnVsbFxufTtcblxuLyoqXG4gKiBTY2hlZHVsZXMgYSBuZXcgcmVhZC93cml0ZVxuICogYmF0Y2ggaWYgb25lIGlzbid0IHBlbmRpbmcuXG4gKlxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gc2NoZWR1bGVGbHVzaChmYXN0ZG9tKSB7XG4gIGlmICghZmFzdGRvbS5zY2hlZHVsZWQpIHtcbiAgICBmYXN0ZG9tLnNjaGVkdWxlZCA9IHRydWU7XG4gICAgZmFzdGRvbS5yYWYoZmx1c2guYmluZChudWxsLCBmYXN0ZG9tKSk7XG4gICAgZGVidWcoJ2ZsdXNoIHNjaGVkdWxlZCcpO1xuICB9XG59XG5cbi8qKlxuICogUnVucyBxdWV1ZWQgYHJlYWRgIGFuZCBgd3JpdGVgIHRhc2tzLlxuICpcbiAqIEVycm9ycyBhcmUgY2F1Z2h0IGFuZCB0aHJvd24gYnkgZGVmYXVsdC5cbiAqIElmIGEgYC5jYXRjaGAgZnVuY3Rpb24gaGFzIGJlZW4gZGVmaW5lZFxuICogaXQgaXMgY2FsbGVkIGluc3RlYWQuXG4gKlxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gZmx1c2goZmFzdGRvbSkge1xuICBkZWJ1ZygnZmx1c2gnKTtcblxuICB2YXIgd3JpdGVzID0gZmFzdGRvbS53cml0ZXM7XG4gIHZhciByZWFkcyA9IGZhc3Rkb20ucmVhZHM7XG4gIHZhciBlcnJvcjtcblxuICB0cnkge1xuICAgIGRlYnVnKCdmbHVzaGluZyByZWFkcycsIHJlYWRzLmxlbmd0aCk7XG4gICAgcnVuVGFza3MocmVhZHMpO1xuICAgIGRlYnVnKCdmbHVzaGluZyB3cml0ZXMnLCB3cml0ZXMubGVuZ3RoKTtcbiAgICBydW5UYXNrcyh3cml0ZXMpO1xuICB9IGNhdGNoIChlKSB7IGVycm9yID0gZTsgfVxuXG4gIGZhc3Rkb20uc2NoZWR1bGVkID0gZmFsc2U7XG5cbiAgLy8gSWYgdGhlIGJhdGNoIGVycm9yZWQgd2UgbWF5IHN0aWxsIGhhdmUgdGFza3MgcXVldWVkXG4gIGlmIChyZWFkcy5sZW5ndGggfHwgd3JpdGVzLmxlbmd0aCkgc2NoZWR1bGVGbHVzaChmYXN0ZG9tKTtcblxuICBpZiAoZXJyb3IpIHtcbiAgICBkZWJ1ZygndGFzayBlcnJvcmVkJywgZXJyb3IubWVzc2FnZSk7XG4gICAgaWYgKGZhc3Rkb20uY2F0Y2gpIGZhc3Rkb20uY2F0Y2goZXJyb3IpO1xuICAgIGVsc2UgdGhyb3cgZXJyb3I7XG4gIH1cbn1cblxuLyoqXG4gKiBXZSBydW4gdGhpcyBpbnNpZGUgYSB0cnkgY2F0Y2hcbiAqIHNvIHRoYXQgaWYgYW55IGpvYnMgZXJyb3IsIHdlXG4gKiBhcmUgYWJsZSB0byByZWNvdmVyIGFuZCBjb250aW51ZVxuICogdG8gZmx1c2ggdGhlIGJhdGNoIHVudGlsIGl0J3MgZW1wdHkuXG4gKlxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gcnVuVGFza3ModGFza3MpIHtcbiAgZGVidWcoJ3J1biB0YXNrcycpO1xuICB2YXIgdGFzazsgd2hpbGUgKHRhc2sgPSB0YXNrcy5zaGlmdCgpKSB0YXNrKCk7XG59XG5cbi8qKlxuICogUmVtb3ZlIGFuIGl0ZW0gZnJvbSBhbiBBcnJheS5cbiAqXG4gKiBAcGFyYW0gIHtBcnJheX0gYXJyYXlcbiAqIEBwYXJhbSAgeyp9IGl0ZW1cbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKi9cbmZ1bmN0aW9uIHJlbW92ZShhcnJheSwgaXRlbSkge1xuICB2YXIgaW5kZXggPSBhcnJheS5pbmRleE9mKGl0ZW0pO1xuICByZXR1cm4gISF+aW5kZXggJiYgISFhcnJheS5zcGxpY2UoaW5kZXgsIDEpO1xufVxuXG4vKipcbiAqIE1peGluIG93biBwcm9wZXJ0aWVzIG9mIHNvdXJjZVxuICogb2JqZWN0IGludG8gdGhlIHRhcmdldC5cbiAqXG4gKiBAcGFyYW0gIHtPYmplY3R9IHRhcmdldFxuICogQHBhcmFtICB7T2JqZWN0fSBzb3VyY2VcbiAqL1xuZnVuY3Rpb24gbWl4aW4odGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yICh2YXIga2V5IGluIHNvdXJjZSkge1xuICAgIGlmIChzb3VyY2UuaGFzT3duUHJvcGVydHkoa2V5KSkgdGFyZ2V0W2tleV0gPSBzb3VyY2Vba2V5XTtcbiAgfVxufVxuXG4vLyBUaGVyZSBzaG91bGQgbmV2ZXIgYmUgbW9yZSB0aGFuXG4vLyBvbmUgaW5zdGFuY2Ugb2YgYEZhc3REb21gIGluIGFuIGFwcFxudmFyIGV4cG9ydHMgPSB3aW4uZmFzdGRvbSA9ICh3aW4uZmFzdGRvbSB8fCBuZXcgRmFzdERvbSgpKTsgLy8ganNoaW50IGlnbm9yZTpsaW5lXG5cbi8vIEV4cG9zZSB0byBDSlMgJiBBTURcbmlmICgodHlwZW9mIGRlZmluZSlbMF0gPT0gJ2YnKSBkZWZpbmUoZnVuY3Rpb24oKSB7IHJldHVybiBleHBvcnRzOyB9KTtcbmVsc2UgaWYgKCh0eXBlb2YgbW9kdWxlKVswXSA9PSAnbycpIG1vZHVsZS5leHBvcnRzID0gZXhwb3J0cztcblxufSkoIHdpbmRvdyB8fCB0aGlzKTtcbiIsInZhciBzaSA9IHR5cGVvZiBzZXRJbW1lZGlhdGUgPT09ICdmdW5jdGlvbicsIHRpY2s7XG5pZiAoc2kpIHtcbiAgdGljayA9IGZ1bmN0aW9uIChmbikgeyBzZXRJbW1lZGlhdGUoZm4pOyB9O1xufSBlbHNlIHtcbiAgdGljayA9IGZ1bmN0aW9uIChmbikgeyBzZXRUaW1lb3V0KGZuLCAwKTsgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB0aWNrOyJdfQ==
