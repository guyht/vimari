/*
 * This implements link hinting. Typing "F" will enter link-hinting mode, where all clickable items on
 * the page have a hint marker displayed containing a sequence of letters. Typing those letters will select
 * a link.
 *
 * The characters we use to show link hints are a user-configurable option. By default they're the home row.
 * The CSS which is used on the link hints is also a configurable option.
 */

var hintMarkers = [];
var hintMarkerContainingDiv = null;
// The characters that were typed in while in "link hints" mode.
var hintKeystrokeQueue = [];
var linkHintsModeActivated = false;
var shouldOpenLinkHintInNewTab = false;
var shouldOpenLinkHintWithQueue = false;
// Whether link hint's "open in current/new tab" setting is currently toggled 
var openLinkModeToggle = false;
// Whether we have added to the page the CSS needed to display link hints.
var linkHintsCssAdded = false;

/* 
 * Generate an XPath describing what a clickable element is.
 * The final expression will be something like "//button | //xhtml:button | ..."
 */
var clickableElementsXPath = (function() {
  var clickableElements = ["a", "textarea", "button", "select", "input[not(@type='hidden')]"];
  var xpath = [];
  for (var i in clickableElements)
    xpath.push("//" + clickableElements[i], "//xhtml:" + clickableElements[i]);
  xpath.push("//*[@onclick]");
  return xpath.join(" | ")
})();

// We need this as a top-level function because our command system doesn't yet support arguments.
function activateLinkHintsModeToOpenInNewTab() { activateLinkHintsMode(true, false); }

function activateLinkHintsModeWithQueue() { activateLinkHintsMode(true, true); }

function activateLinkHintsMode(openInNewTab, withQueue) {
  if (!linkHintsCssAdded)
    addCssToPage(linkHintCss); // linkHintCss is declared by vimiumFrontend.js
  linkHintCssAdded = true;
  linkHintsModeActivated = true;
  setOpenLinkMode(openInNewTab, withQueue);
  buildLinkHints();
  document.addEventListener("keydown", onKeyDownInLinkHintsMode, true);
  document.addEventListener("keyup", onKeyUpInLinkHintsMode, true);
}

function setOpenLinkMode(openInNewTab, withQueue) {
  shouldOpenLinkHintInNewTab = openInNewTab;
  shouldOpenLinkHintWithQueue = withQueue;
  return;
  /*
  if (shouldOpenLinkHintWithQueue) {
    HUD.show("Open multiple links in a new tab");
  } else {
    if (shouldOpenLinkHintInNewTab)
      HUD.show("Open link in new tab");
    else
      HUD.show("Open link in current tab");
  }*/
}

/*
 * Builds and displays link hints for every visible clickable item on the page.
 */
function buildLinkHints() {
  var visibleElements = getVisibleClickableElements();

  // Initialize the number used to generate the character hints to be as many digits as we need to
  // highlight all the links on the page; we don't want some link hints to have more chars than others.
  var digitsNeeded = Math.ceil(logXOfBase(visibleElements.length, settings.linkHintCharacters.length));
  var linkHintNumber = 0;
  for (var i = 0; i < visibleElements.length; i++) {
    hintMarkers.push(createMarkerFor(visibleElements[i], linkHintNumber, digitsNeeded));
    linkHintNumber++;
  }
  // Note(philc): Append these markers as top level children instead of as child nodes to the link itself,
  // because some clickable elements cannot contain children, e.g. submit buttons. This has the caveat
  // that if you scroll the page and the link has position=fixed, the marker will not stay fixed.
  // Also note that adding these nodes to document.body all at once is significantly faster than one-by-one.
  hintMarkerContainingDiv = document.createElement("div");
  hintMarkerContainingDiv.id = "vimiumHintMarkerContainer";
  hintMarkerContainingDiv.className = "vimiumReset";
  for (var i = 0; i < hintMarkers.length; i++)
    hintMarkerContainingDiv.appendChild(hintMarkers[i]);
  document.body.appendChild(hintMarkerContainingDiv);
}

function logXOfBase(x, base) { return Math.log(x) / Math.log(base); }

/*
 * Returns all clickable elements that are not hidden and are in the current viewport.
 * We prune invisible elements partly for performance reasons, but moreso it's to decrease the number
 * of digits needed to enumerate all of the links on screen.
 */
function getVisibleClickableElements() {
  var resultSet = document.evaluate(clickableElementsXPath, document.body,
    function (namespace) {
      return namespace == "xhtml" ? "http://www.w3.org/1999/xhtml" : null;
    },
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

  // Find all visible clickable elements.
  var visibleElements = [];

  for (var i = 0; i < resultSet.snapshotLength; i++) {
    var element = resultSet.snapshotItem(i);

    // Inline elements can have more than one rect.
    // Block elemens only have one rect.
    // So, in general, add element's first visible rect, if any.
    // If element does not have any visible rect, 
    // it can still be wrapping other floated children.
    // In that case, add rect of first visible floated child, if any.
    var selectedRect = getFirstVisibleRect(element) || getFirstVisibleFloatedChildRect(element);
    if (selectedRect) {
      visibleElements.push(selectedRect);
    }
  }

  return visibleElements;
}

function getFirstVisibleRect(element) {
  var clientRects = element.getClientRects();
  for (var i = 0; i < clientRects.length; i++) {
    var clientRect = clientRects[i];
    if (isVisible(element, clientRect)) {
      return {element: element, rect: clientRect};
    }
  }
  return null;
}

function getFirstVisibleFloatedChildRect(element) {
  for (var i = 0; i < element.children.length; i++) {
    if (window.getComputedStyle(element.children[i], null).getPropertyValue('float') != 'none') {
      // Floated elements are block level, and so, only have one rect.
      var childClientRect = element.children[i].getClientRects()[0];
      if (isVisible(element.children[i], childClientRect)) {
        return {element: element.children[i], rect: childClientRect};
      }
    }
  }
  return null;
}
/*
 * Returns true if element is visible.
 */
function isVisible(element, clientRect) {
  // Exclude links which have just a few pixels on screen, because the link hints won't show for them anyway.
  var zoomFactor = currentZoomLevel / 100.0;
  if (!clientRect || clientRect.top < 0 || clientRect.top * zoomFactor >= window.innerHeight - 4 ||
      clientRect.left < 0 || clientRect.left * zoomFactor >= window.innerWidth - 4)
    return false;

  if (clientRect.width < 3 || clientRect.height < 3)
    return false;

  // eliminate invisible elements (see test_harnesses/visibility_test.html)
  var computedStyle = window.getComputedStyle(element, null);
  if (computedStyle.getPropertyValue('visibility') != 'visible' ||
      computedStyle.getPropertyValue('display') == 'none')
    return false;

  return true;
}

function onKeyDownInLinkHintsMode(event) {
  console.log("Key Down");
  if (event.keyCode == keyCodes.shiftKey && !openLinkModeToggle) {
    // Toggle whether to open link in a new or current tab.
    setOpenLinkMode(!shouldOpenLinkHintInNewTab, shouldOpenLinkHintWithQueue);
    openLinkModeToggle = true;
  }

  var keyChar = getKeyChar(event);
  if (!keyChar)
    return;

  // TODO(philc): Ignore keys that have modifiers.
  if (isEscape(event)) {
    deactivateLinkHintsMode();
  } else if (event.keyCode == keyCodes.backspace || event.keyCode == keyCodes.deleteKey) {
    if (hintKeystrokeQueue.length == 0) {
      deactivateLinkHintsMode();
    } else {
      hintKeystrokeQueue.pop();
      updateLinkHints();
    }
  } else if (settings.linkHintCharacters.indexOf(keyChar) >= 0) {
    hintKeystrokeQueue.push(keyChar);
    updateLinkHints();
  } else {
    return;
  }

  event.stopPropagation();
  event.preventDefault();
}

function onKeyUpInLinkHintsMode(event) {
  if (event.keyCode == keyCodes.shiftKey && openLinkModeToggle) {
    // Revert toggle on whether to open link in new or current tab. 
    setOpenLinkMode(!shouldOpenLinkHintInNewTab, shouldOpenLinkHintWithQueue);
    openLinkModeToggle = false;
  }
  event.stopPropagation();
  event.preventDefault();
}

/*
 * Updates the visibility of link hints on screen based on the keystrokes typed thus far. If only one
 * link hint remains, click on that link and exit link hints mode.
 */
function updateLinkHints() {
  var matchString = hintKeystrokeQueue.join("");
  var linksMatched = highlightLinkMatches(matchString);
  if (linksMatched.length == 0)
    deactivateLinkHintsMode();
  else if (linksMatched.length == 1) {
    var matchedLink = linksMatched[0];
    if (isSelectable(matchedLink)) {
      matchedLink.focus();
      // When focusing a textbox, put the selection caret at the end of the textbox's contents.
      matchedLink.setSelectionRange(matchedLink.value.length, matchedLink.value.length);
      deactivateLinkHintsMode();
    } else {
      // When we're opening the link in the current tab, don't navigate to the selected link immediately;
      // we want to give the user some feedback depicting which link they've selected by focusing it.
      if (shouldOpenLinkHintWithQueue) {
        simulateClick(matchedLink);
        resetLinkHintsMode();
      } else if (shouldOpenLinkHintInNewTab) {
        simulateClick(matchedLink);
        matchedLink.focus();
        deactivateLinkHintsMode();
      } else {
        setTimeout(function() { simulateClick(matchedLink); }, 400);
        matchedLink.focus();
        deactivateLinkHintsMode();
      }
    }
  }
}

/*
 * Selectable means the element has a text caret; this is not the same as "focusable".
 */
function isSelectable(element) {
  var selectableTypes = ["search", "text", "password"];
  return (element.tagName == "INPUT" && selectableTypes.indexOf(element.type) >= 0) ||
      element.tagName == "TEXTAREA";
}

/*
 * Hides link hints which do not match the given search string. To allow the backspace key to work, this
 * will also show link hints which do match but were previously hidden.
 */
function highlightLinkMatches(searchString) {
  var linksMatched = [];
  for (var i = 0; i < hintMarkers.length; i++) {
    var linkMarker = hintMarkers[i];
    if (linkMarker.getAttribute("hintString").indexOf(searchString) == 0) {
      if (linkMarker.style.display == "none")
        linkMarker.style.display = "";
      for (var j = 0; j < linkMarker.childNodes.length; j++)
        linkMarker.childNodes[j].className = (j >= searchString.length) ? "" : "matchingCharacter";
      linksMatched.push(linkMarker.clickableItem);
    } else {
      linkMarker.style.display = "none";
    }
  }
  return linksMatched;
}

/*
 * Converts a number like "8" into a hint string like "JK". This is used to sequentially generate all of
 * the hint text. The hint string will be "padded with zeroes" to ensure its length is equal to numHintDigits.
 */
function numberToHintString(number, numHintDigits) {
  var base = settings.linkHintCharacters.length;
  var hintString = [];
  var remainder = 0;
  do {
    remainder = number % base;
    hintString.unshift(settings.linkHintCharacters[remainder]);
    number -= remainder;
    number /= Math.floor(base);
  } while (number > 0);

  // Pad the hint string we're returning so that it matches numHintDigits.
  var hintStringLength = hintString.length;
  for (var i = 0; i < numHintDigits - hintStringLength; i++)
    hintString.unshift(settings.linkHintCharacters[0]);
  return hintString.join("");
}

function simulateClick(link) {
  var event = document.createEvent("MouseEvents");
  // When "clicking" on a link, dispatch the event with the appropriate meta key (CMD on Mac, CTRL on windows)
  // to open it in a new tab if necessary.
  var metaKey = (platform == "Mac" && shouldOpenLinkHintInNewTab);
  var ctrlKey = (platform != "Mac" && shouldOpenLinkHintInNewTab);
  event.initMouseEvent("click", true, true, window, 1, 0, 0, 0, 0, ctrlKey, false, false, metaKey, 0, null);

  // Debugging note: Firefox will not execute the link's default action if we dispatch this click event,
  // but Webkit will. Dispatching a click on an input box does not seem to focus it; we do that separately
  link.dispatchEvent(event);
}

function deactivateLinkHintsMode() {
  if (hintMarkerContainingDiv)
    hintMarkerContainingDiv.parentNode.removeChild(hintMarkerContainingDiv);
  hintMarkerContainingDiv = null;
  hintMarkers = [];
  hintKeystrokeQueue = [];
  document.removeEventListener("keydown", onKeyDownInLinkHintsMode, true);
  document.removeEventListener("keyup", onKeyUpInLinkHintsMode, true);
  linkHintsModeActivated = false;
  //HUD.hide();
}

function resetLinkHintsMode() {
  deactivateLinkHintsMode();
  activateLinkHintsModeWithQueue();
}

/*
 * Creates a link marker for the given link.
 */
function createMarkerFor(link, linkHintNumber, linkHintDigits) {
  var hintString = numberToHintString(linkHintNumber, linkHintDigits);
  var marker = document.createElement("div");
  marker.className = "internalVimiumHintMarker vimiumReset";
  var innerHTML = [];
  // Make each hint character a span, so that we can highlight the typed characters as you type them.
  for (var i = 0; i < hintString.length; i++)
    innerHTML.push('<span class="vimiumReset">' + hintString[i].toUpperCase() + '</span>');
  marker.innerHTML = innerHTML.join("");
  marker.setAttribute("hintString", hintString);

  // Note: this call will be expensive if we modify the DOM in between calls.
  var clientRect = link.rect;
  // The coordinates given by the window do not have the zoom factor included since the zoom is set only on
  // the document node.
  var zoomFactor = currentZoomLevel / 100.0;
  marker.style.left = clientRect.left + window.scrollX / zoomFactor + "px";
  marker.style.top = clientRect.top  + window.scrollY / zoomFactor + "px";

  marker.clickableItem = link.element;
  return marker;
}
