const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadAppForTest() {
  const source = readFileSync("app.js", "utf8").replace(
    /\ninitialize\(\);\s*$/,
    `
globalThis.__familiengarageTestApi = {
  dateKeyInBerlin,
  findConflict,
  formatDateTimeInput,
  formatReservationRange,
  isAllDayReservation,
  parseGermanDate,
  parseGermanDateTime,
  reservationFromForm,
  setReservations: (items) => { reservations = items; },
  toCalendarEvent,
  elements,
};`,
  );
  const noop = () => {};
  const createElement = () => ({
    addEventListener: noop,
    append: noop,
    classList: { add: noop, remove: noop, toggle: noop },
    removeAttribute: noop,
    replaceChildren: noop,
    setAttribute: noop,
    value: "",
    checked: false,
  });
  const context = {
    Date,
    Intl,
    crypto: { randomUUID: () => "test-id" },
    document: {
      createElement,
      createTextNode: () => ({}),
      querySelector: createElement,
      querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem: noop },
    window: {
      FAMILY_GARAGE_BACKEND: { isSupabaseConfigured: false, supabase: null, configurationError: "" },
      addEventListener: noop,
      clearTimeout: noop,
      matchMedia: () => ({ addEventListener: noop, addListener: noop, matches: false }),
      setTimeout: noop,
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "app.js" });
  return context.__familiengarageTestApi;
}

test("accepts and normalizes valid German date and time input", () => {
  const app = loadAppForTest();
  const date = app.parseGermanDateTime("04.09.2026, 08:30");

  assert.ok(date);
  assert.equal(app.formatDateTimeInput(date), "04.09.2026, 08:30");
  assert.equal(app.parseGermanDate("04.09.2026").getDate(), 4);
  assert.equal(app.parseGermanDateTime("31.02.2026, 08:30"), null);
  assert.equal(app.parseGermanDateTime("04.09.2026, 24:00"), null);
});

test("loads the localized visual date and time picker", () => {
  const document = readFileSync("index.html", "utf8");

  assert.match(document, /flatpickr@4\.6\.13\/dist\/flatpickr\.min\.css/);
  assert.match(document, /flatpickr@4\.6\.13\/dist\/l10n\/de\.js/);
  assert.match(document, /placeholder="Datum und Uhrzeit auswählen"/);
});

test("creates a complete reservation from the German form values", () => {
  const app = loadAppForTest();
  app.elements.carSelect.value = "Dethleffs Just 90";
  app.elements.personSelect.value = "Wolfgang";
  app.elements.startDateTime.value = "04.09.2026, 08:30";
  app.elements.endDateTime.value = "04.09.2026, 10:00";
  app.elements.notes.value = "Wochenendausflug";

  const reservation = app.reservationFromForm();

  assert.equal(reservation.car, "Dethleffs Just 90");
  assert.equal(reservation.person, "Wolfgang");
  assert.equal(reservation.is_all_day, false);
  assert.equal(reservation.notes, "Wochenendausflug");
  assert.equal(new Date(reservation.start_time).getHours(), 8);
  assert.equal(new Date(reservation.end_time).getMinutes(), 0);
});

test("rejects overlaps while allowing reservations that touch at their boundary", () => {
  const app = loadAppForTest();
  app.setReservations([
    {
      car: "BMW 320d",
      person: "Anja",
      start_time: "2026-09-04T08:00:00.000Z",
      end_time: "2026-09-04T10:00:00.000Z",
    },
  ]);

  assert.equal(
    app.findConflict({ car: "BMW 320d", start_time: "2026-09-04T09:00:00.000Z", end_time: "2026-09-04T11:00:00.000Z" }).person,
    "Anja",
  );
  assert.equal(
    app.findConflict({ car: "BMW 320d", start_time: "2026-09-04T10:00:00.000Z", end_time: "2026-09-04T11:00:00.000Z" }),
    undefined,
  );
});

test("keeps all-day reservations stable in the family time zone", () => {
  const app = loadAppForTest();
  const reservation = {
    id: "all-day",
    car: "Nissan Townstar",
    person: "Wilke",
    start_time: "2026-09-03T22:00:00.000Z",
    end_time: "2026-09-04T22:00:00.000Z",
    is_all_day: true,
  };
  const event = app.toCalendarEvent(reservation);

  assert.equal(event.start, "2026-09-04");
  assert.equal(event.end, "2026-09-05");
  assert.equal(event.backgroundColor, "#d1fae5");
  assert.equal(event.textColor, "#075e4c");
  assert.equal(app.isAllDayReservation(reservation), true);
  assert.equal(app.formatReservationRange(reservation), "Ganztägig · 04.09.2026");
  assert.equal(app.dateKeyInBerlin(new Date(reservation.start_time)), "2026-09-04");
});
