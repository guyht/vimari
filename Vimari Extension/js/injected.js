/*
 * Vimari injected script.
 *
 * This script is called before the requested page is loaded.  This allows us
 * to intercept events before they are passed to the requested pages code and
 * therefore we can stop certain pages (google) stealing the focus.
 */


/*
 * Global vars
 *
 * topWindow        - true if top window, false if iframe
 * settings         - stores user settings
 * currentZoomLevel - required for vimium scripts to run correctly
 * linkHintCss      - required from vimium scripts
 * extensionActive  - is the extension currently enabled (should only be true when tab is active)
 * shiftKeyToggle   - is shift key currently toggled
 */

var topWindow = (window.top === window),
    settings = {},
    currentZoomLevel = 100,
    linkHintCss = {},
    extensionActive = true,
    insertMode = false,
    shiftKeyToggle = false,
//     hudDuration = 5000,
    extensionCommunicator = SafariExtensionCommunicator(messageHandler);

var actionMap = {
    'hintToggle' : function() {
        vNotify.notify({text: 'Current Tab', title:'Vimari', visibleDuration: 2000, showClose: false});
//        HUD.showForDuration('Open link in current tab', hudDuration);
        activateLinkHintsMode(false, false); },

    'newTabHintToggle' : function() {
        vNotify.notify({text: 'New Tab', title:'Vimari', visibleDuration: 2000, showClose: false});
//        HUD.showForDuration('Open link in new tab', hudDuration);
        activateLinkHintsMode(true, false); },

    'tabForward':
        function() { extensionCommunicator.requestTabForward(); },

    'tabBack':
        function() { extensionCommunicator.requestTabBackward() },

    'scrollDown':
        function() { customScrollBy(0, settings.scrollSize); },

    'scrollUp':
        function() { customScrollBy(0, -settings.scrollSize); },

    'scrollLeft':
        function() { customScrollBy(-settings.scrollSize, 0); },

    'scrollRight':
        function() { customScrollBy(settings.scrollSize, 0); },

    'goBack':
        function() { window.history.back(); },

    'goForward':
        function() { window.history.forward(); },

    'reload':
        function() { window.location.reload(); },

    'openTab':
        function() { extensionCommunicator.requestNewTab(); },

    'closeTab':
        function() { extensionCommunicator.requestCloseTab(); },

  	'scrollDownHalfPage':
	    	function() { customScrollBy(0, window.innerHeight / 2); },

    'scrollUpHalfPage':
		    function() { customScrollBy(0, window.innerHeight / -2); },

   	'goToPageBottom':
	    	function() { customScrollBy(0, document.body.scrollHeight); },

    'goToPageTop':
        function() { customScrollBy(0, -document.body.scrollHeight); },

    'goToFirstInput':
        function() { goToFirstInput(); }
};

// Inspiration and general algorithm taken from sVim.
function goToFirstInput() {
  var inputs = document.querySelectorAll('input,textarea');

  var bestInput = null;
  var bestInViewInput = null;

  inputs.forEach(function(input) {
    // Skip if hidden or disabled
    if ((input.offsetParent === null) ||
        input.disabled ||
        (input.getAttribute('type') === 'hidden') ||
        (getComputedStyle(input).visibility === 'hidden') ||
        (input.getAttribute('display') === 'none')) {
      return;
    }

    // Skip things that are not actual inputs
    if ((input.localName !== 'textarea') &&
        (input.localName !== 'input') &&
        (input.getAttribute('contenteditable') !== 'true')) {
      return;
    }

    // Skip non-text inputs
    if (/button|radio|file|image|checkbox|submit/i.test(input.getAttribute('type'))) {
      return;
    }

    var inputRect = input.getClientRects()[0];
    var isInView = (inputRect.top >= -inputRect.height) &&
                   (inputRect.top <= window.innerHeight) &&
                   (inputRect.left >= -inputRect.width) &&
                   (inputRect.left <= window.innerWidth);

    if (bestInput === null) {
      bestInput = input;
    }

    if (isInView && (bestInViewInput === null)) {
      bestInViewInput = input;
    }
  });

  var inputToFocus = bestInViewInput || bestInput;
  if (inputToFocus !== null) {
    inputToFocus.focus();
  }
}

// Meant to be overridden, but still has to be copy/pasted from the original...
Mousetrap.prototype.stopCallback = function(e, element, combo) {
    // Escape key is special, no need to stop. Vimari-specific.
    if (combo === 'esc' || combo === 'ctrl+[') { return false; }

  // Preserve the behavior of allowing ex. ctrl-j in an input
  if (settings.modifier) { return false; }

    // if the element has the class "mousetrap" then no need to stop
    if ((' ' + element.className + ' ').indexOf(' mousetrap ') > -1) {
        return false;
    }

    var tagName = element.tagName;
    var contentIsEditable = (element.contentEditable && element.contentEditable === 'true');

    // stop for input, select, and textarea
    return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || contentIsEditable;
};

// Set up key codes to event handlers
function bindKeyCodesToActions(settings) {
    var excludedUrl = false
    if (typeof settings != "undefined") {
        excludedUrl = isExcludedUrl(settings.excludedUrls, document.URL)
    }
    // Only add if topWindow... not iframe
    Mousetrap.reset();
    if (topWindow && !excludedUrl) {
        Mousetrap.bind('esc', enterNormalMode);
        Mousetrap.bind('ctrl+[', enterNormalMode);
        Mousetrap.bind('i', enterInsertMode);
        for (var actionName in actionMap) {
            if (actionMap.hasOwnProperty(actionName)) {
                var keyCode = getKeyCode(actionName);
                Mousetrap.bind(keyCode, executeAction(actionName), 'keydown');
            }
        }
    }
}

function enterNormalMode() {
    // Clear input focus
    document.activeElement.blur();

    // Clear link hints (if any)
    deactivateLinkHintsMode();

    if (insertMode === false) {
        return // We are already in normal mode.
    }

    // Re-enable if in insert mode
    insertMode = false;
    Mousetrap.bind('i', enterInsertMode);
    var container = document.querySelectorAll('.vnotify-container');
    for (var i=0; i< container.length; i++) {
      container[i].outerHTML = '';
      container[i] = null;
    }
    vNotify.notify({text: 'Normal Mode', title:'Vimari', visibleDuration: 500, showClose: false});
}

// Calling it 'insert mode', but it's really just a user-triggered
// off switch for the actions.
function enterInsertMode() {
    insertMode = true;
    Mousetrap.unbind('i');
    vNotify.notify({text: 'Insert Mode', title:'Vimari', visibleDuration: 500, showClose: false, sticky: true});
}

function executeAction(actionName) {
    return function() {
        // don't do anything if we're not supposed to
        if (linkHintsModeActivated || !extensionActive || insertMode)
            return;

        //Call the action function
        actionMap[actionName]();

        // Tell mousetrap to stop propagation
        return false;
    }
}

function unbindKeyCodes() {
    Mousetrap.reset();
    document.removeEventListener("keydown", stopSitePropagation);
}

// Stops propagation of keyboard events in normal mode.  Adding this
// callback to the document using the useCapture flag allows us to
// prevent custom key behaviour implemented by the underlying website.
function stopSitePropagation() {
    return function (e) {
        if (insertMode == false && !isActiveElementEditable()) {
            e.stopPropagation()
        }
    }
}

// Check whether the current active element is editable.
function isActiveElementEditable() {
    const el = document.activeElement;
    return (el != null && isEditable(el))
}
 

// Adds an optional modifier to the configured key code for the action
function getKeyCode(actionName) {
    var keyCode = '';
    if (typeof settings != 'undefined') {
        if(settings.modifier) {
            keyCode += settings.modifier + '+';
        }
        return keyCode + settings["bindings"][actionName];
    }
    return keyCode;
}


/*
 * Adds the given CSS to the page.
 * This function is required by vimium but depracated for vimari as the
 * css is pre loaded into the page.
 */
function addCssToPage(css) {
    return;
}


/*
 * Input or text elements are considered focusable and able to receive their own keyboard events,
 * and will enter enter mode if focused. Also note that the "contentEditable" attribute can be set on
 * any element which makes it a rich text editor, like the notes on jjot.com.
 * Note: we used to discriminate for text-only inputs, but this is not accurate since all input fields
 * can be controlled via the keyboard, particularly SELECT combo boxes.
 */
function isEditable(target) {
    if (target.getAttribute("contentEditable") === "true")
        return true;
    var focusableInputs = ["input", "textarea", "select", "button"];
    return focusableInputs.indexOf(target.tagName.toLowerCase()) >= 0;
}


/*
 * Embedded elements like Flash and quicktime players can obtain focus but cannot be programmatically
 * unfocused.
 */
function isEmbed(element) { return ["EMBED", "OBJECT"].indexOf(element.tagName) > 0; }


// ==========================
// Message handling functions
// ==========================

function messageHandler(event){
    if (event.name == "updateSettingsEvent") {
        setSettings(event.message);
    }
}

/*
 * Callback to pass settings to injected script
 */
function setSettings(msg) {
    settings = msg;
    activateExtension(settings);
}

function activateExtension(settings) {
    // Stop keydown propagation
    document.addEventListener("keydown", stopSitePropagation(), true);
    bindKeyCodesToActions(settings);
}

function isExcludedUrl(storedExcludedUrls, currentUrl) {
    if (!storedExcludedUrls.length) {
        return false;
    }

    var excludedUrls, regexp, url, formattedUrl, _i, _len;
    excludedUrls = storedExcludedUrls.split(",");
    for (_i = 0, _len = excludedUrls.length; _i < _len; _i++) {
        url = excludedUrls[_i];
        formattedUrl = stripProtocolAndWww(url);
        formattedUrl = formattedUrl.toLowerCase().trim();
        regexp = new RegExp('((.*)?(' + formattedUrl + ')+(.*))');
        if (currentUrl.toLowerCase().match(regexp)) {
            return true;
        }
    }
    return false;
}

// These formations removes the protocol and www so that
// the regexp can catch less AND more specific excluded
// domains than the current URL.
function stripProtocolAndWww(url) {
  url = url.replace('http://', '');
  url = url.replace('https://', '');
  if (url.startsWith('www.')) {
      url = url.slice(4);
  }

  return url;
}

// Add event listener
function inIframe () {
    try {
        return window.self !== window.top;
    }
    catch (e) {
        return true;
    }
}

if(!inIframe()){
    extensionCommunicator.requestSettingsUpdate()
}
                                 
// Export to make it testable
window.isExcludedUrl = isExcludedUrl;
window.stripProtocolAndWww = stripProtocolAndWww;
