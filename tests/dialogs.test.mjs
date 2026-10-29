import assert from 'node:assert/strict';
import test from 'node:test';
import { Dialogs } from '../src/dialogs.ts';

function environment(context) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  class Element extends EventTarget {
    hidden = true;
    inert = false;
    children = [];
    classes = new Set();
    classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
    style = { overflow: '' };
    focus() { document.activeElement = this; }
    querySelector() { return null; }
    querySelectorAll() { return this.children; }
    contains(node) { return node === this || this.children.includes(node); }
  }
  const doc = Object.assign(new EventTarget(), { activeElement: new Element(), body: new Element() });
  for (const [key, value] of Object.entries({ document: doc, HTMLElement: Element })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  const background = new Element();
  const backdrop = new Element();
  const close = new Element();
  backdrop.children.push(close);
  const trigger = doc.activeElement;
  const dialogs = new Dialogs([background]);
  return { Element, doc, background, backdrop, close, trigger, dialogs };
}

test('sidebar closing keeps focus contained and the game inert until its slide finishes', context => {
  const { dialogs, backdrop, background, trigger, doc, close } = environment(context);
  let closed = 0;
  dialogs.register(backdrop, close, { exitMs: () => 250, onClose: () => closed++ });
  dialogs.open(backdrop);
  assert.equal(backdrop.hidden, false);
  assert.equal(background.inert, true);
  assert.equal(doc.activeElement, close);
  dialogs.close();
  context.mock.timers.tick(100);
  dialogs.close();
  context.mock.timers.tick(149);
  assert.equal(dialogs.isOpen, true);
  assert.equal(backdrop.classes.has('is-closing'), true);
  assert.equal(background.inert, true);
  context.mock.timers.tick(1);
  assert.equal(backdrop.hidden, true);
  assert.equal(background.inert, false);
  assert.equal(doc.activeElement, trigger);
  assert.equal(closed, 1);
});

test('opening another dialog cancels a pending sidebar close without hiding the new dialog', context => {
  const { dialogs, backdrop, background, close, Element } = environment(context);
  dialogs.register(backdrop, close, { exitMs: () => 250 });
  dialogs.open(backdrop);
  dialogs.close();
  const second = new Element();
  second.children.push(new Element());
  dialogs.open(second);
  context.mock.timers.tick(1000);
  assert.equal(backdrop.hidden, true);
  assert.equal(second.hidden, false);
  assert.equal(background.inert, true);
  dialogs.close();
  assert.equal(second.hidden, true);
});

test('reduced-motion sidebar exits immediately and Escape still closes it', context => {
  const { dialogs, backdrop, close, doc } = environment(context);
  dialogs.register(backdrop, close, { exitMs: () => 0 });
  dialogs.open(backdrop);
  const escape = new Event('keydown', { cancelable: true });
  Object.assign(escape, { key: 'Escape' });
  doc.dispatchEvent(escape);
  assert.equal(dialogs.isOpen, false);
  assert.equal(backdrop.hidden, true);
  assert.equal(escape.defaultPrevented, true);
});
