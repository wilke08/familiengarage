const backend = window.FAMILY_GARAGE_BACKEND;

const CARS = [
  { id: "BMW 320d", short: "BMW", compact: "BMW", color: "#2563eb", soft: "#dbeafe", text: "#173d84" },
  { id: "Nissan Townstar", short: "Nissan", compact: "NIS", color: "#0f9b78", soft: "#d1fae5", text: "#075e4c" },
  { id: "Dethleffs Just 90", short: "Dethleffs", compact: "MOB", color: "#d97706", soft: "#fef3c7", text: "#8a4507" },
];
const PEOPLE = ["Wilke", "Wolfgang", "Anja"];
const DE_LOCALE = "de-DE";
const compactCalendarMedia = window.matchMedia("(max-width: 639px)");

const $ = (selector) => document.querySelector(selector);
const elements = {
  calendar: $("#calendar"),
  calendarTitle: $("#calendar-title"),
  carFilter: $("#filter-car"),
  personFilter: $("#filter-person"),
  emptyState: $("#empty-state"),
  syncStatus: $("#sync-status"),
  bookingDialog: $("#booking-dialog"),
  detailsDialog: $("#reservation-dialog"),
  bookingForm: $("#booking-form"),
  carSelect: $("#reservation-car"),
  personSelect: $("#reservation-person"),
  allDay: $("#all-day"),
  timedFields: $("#timed-fields"),
  allDayFields: $("#all-day-fields"),
  datetimeFormatHint: $("#datetime-format-hint"),
  allDayFormatHint: $("#all-day-format-hint"),
  startDateTime: $("#start-datetime"),
  endDateTime: $("#end-datetime"),
  startDate: $("#start-date"),
  endDate: $("#end-date"),
  notes: $("#reservation-notes"),
  formMessage: $("#form-message"),
  saveButton: $("#save-reservation"),
  detailCar: $("#detail-car"),
  detailHeading: $("#reservation-heading"),
  detailTime: $("#detail-time"),
  detailNotes: $("#detail-notes"),
  detailNotesGroup: $("#detail-notes-group"),
  closeDetails: $("#close-details"),
  deleteButton: $("#delete-reservation"),
  toast: $("#toast"),
};

let reservations = [];
let calendar;
let selectedReservation = null;
let syncTimer = null;
let loadInFlight = false;
let toastTimer;
let latestLoadRequest = 0;
let reservationPickers = {};

function initialize() {
  populateSelects();
  renderLegend();
  configureCalendar();
  initializeReservationPickers();
  bindEvents();
  initializeData();
}

function populateSelects() {
  const carOptions = CARS.map((car) => `<option value="${car.id}">${car.id}</option>`).join("");
  const personOptions = PEOPLE.map((person) => `<option value="${person}">${person}</option>`).join("");
  elements.carFilter.insertAdjacentHTML("beforeend", carOptions);
  elements.personFilter.insertAdjacentHTML("beforeend", personOptions);
  elements.carSelect.innerHTML = `<option value="" selected disabled>Fahrzeug auswählen</option>${carOptions}`;
  elements.personSelect.innerHTML = `<option value="" selected disabled>Person auswählen</option>${personOptions}`;
}

function renderLegend() {
  const legend = $("#car-legend");
  legend.replaceChildren(
    ...CARS.map((car) => {
      const item = document.createElement("li");
      item.className = "flex items-center gap-3";
      item.innerHTML = `<span class="car-dot" style="background:${car.color}"></span><span class="text-sm font-semibold text-slate-100">${car.id}</span>`;
      return item;
    }),
  );
}

function initializeReservationPickers() {
  if (typeof window.flatpickr !== "function") return;

  const sharedOptions = {
    allowInput: false,
    static: true,
    disableMobile: true,
    locale: window.flatpickr.l10ns.de,
    onOpen: (_dates, _value, picker) => {
      window.requestAnimationFrame(() => picker.calendarContainer.scrollIntoView({ block: 'nearest' }));
    },
    onChange: () => validateReservationTiming(),
  };
  reservationPickers = {
    startDateTime: window.flatpickr(elements.startDateTime, {
      ...sharedOptions,
      dateFormat: "d.m.Y, H:i",
      enableTime: true,
      minuteIncrement: 30,
      time_24hr: true,
    }),
    endDateTime: window.flatpickr(elements.endDateTime, {
      ...sharedOptions,
      dateFormat: "d.m.Y, H:i",
      enableTime: true,
      minuteIncrement: 30,
      time_24hr: true,
    }),
    startDate: window.flatpickr(elements.startDate, {
      ...sharedOptions,
      dateFormat: "d.m.Y",
    }),
    endDate: window.flatpickr(elements.endDate, {
      ...sharedOptions,
      dateFormat: "d.m.Y",
    }),
  };
}

function configureCalendar() {
  calendar = new FullCalendar.Calendar(elements.calendar, {
    locale: "de",
    firstDay: 1,
    initialView: "dayGridMonth",
    headerToolbar: false,
    height: "auto",
    fixedWeekCount: false,
    dayMaxEvents: compactCalendarMedia.matches ? 2 : false,
    nowIndicator: true,
    allDayText: "Ganztägig",
    buttonText: { today: "Heute" },
    eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
    views: {
      dayGridMonth: { dayMaxEventRows: false },
      timeGridWeek: { slotMinTime: "06:00:00", slotMaxTime: "23:00:00", slotDuration: "00:30:00" },
      timeGridDay: { slotMinTime: "06:00:00", slotMaxTime: "23:00:00", slotDuration: "00:30:00" },
    },
    events: (info, successCallback) => successCallback(filteredCalendarEvents()),
    datesSet: updateCalendarTitle,
    dateClick: (info) => openBooking({ date: info.date }),
    dayCellDidMount: (info) => {
      if (!info.view.type.startsWith("dayGrid")) return;
      const dayNumber = info.el.querySelector(".fc-daygrid-day-number");
      if (!dayNumber) return;
      dayNumber.tabIndex = 0;
      dayNumber.setAttribute("role", "button");
      dayNumber.setAttribute("aria-label", `Neue Reservierung für ${formatDate(info.date)}`);
      dayNumber.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openBooking({ date: info.date });
      });
    },
    eventClick: (info) => openDetails(info.event.extendedProps.reservationId),
    eventContent: renderEventContent,
    eventDidMount: (info) => {
      const reservation = info.event.extendedProps.reservation;
      const label = `${reservation.car}, reserviert von ${reservation.person}, ${formatReservationRange(reservation)}.`;
      info.el.title = `${label}${reservation.notes ? ` ${reservation.notes}` : ""}`;
      info.el.setAttribute("aria-label", `${label} Details öffnen.`);
    },
  });
  calendar.render();
}

function bindEvents() {
  $("#new-reservation").addEventListener("click", () => openBooking());
  $("#close-booking").addEventListener("click", closeBooking);
  $("#cancel-booking").addEventListener("click", closeBooking);
  $("#close-details").addEventListener("click", closeDetails);
  $("#close-details-secondary").addEventListener("click", closeDetails);
  $("#previous-period").addEventListener("click", () => calendar.prev());
  $("#next-period").addEventListener("click", () => calendar.next());
  $("#today-button").addEventListener("click", () => calendar.today());
  $("#delete-reservation").addEventListener("click", deleteReservation);
  elements.carFilter.addEventListener("change", refreshCalendar);
  elements.personFilter.addEventListener("change", refreshCalendar);
  elements.allDay.addEventListener("change", updateDateInputMode);
  elements.bookingForm.addEventListener("submit", saveReservation);

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const requestedView = button.dataset.view;
      const viewName = requestedView === "timeGridWeek" && compactCalendarMedia.matches ? "timeGridDay" : requestedView;
      calendar.changeView(viewName);
      document.querySelectorAll("[data-view]").forEach((viewButton) => {
        const active = viewButton === button;
        viewButton.classList.toggle("is-active", active);
        viewButton.setAttribute("aria-pressed", String(active));
      });
    });
  });

  [elements.carSelect, elements.startDateTime, elements.endDateTime, elements.startDate, elements.endDate].forEach((input) => {
    input.addEventListener("change", validateReservationTiming);
  });
  [elements.startDateTime, elements.endDateTime].forEach((input) => {
    input.addEventListener("blur", () => {
      normalizeDateTimeInput(input);
      validateReservationTiming();
    });
  });
  [elements.startDate, elements.endDate].forEach((input) => {
    input.addEventListener("blur", () => {
      normalizeDateInput(input);
      validateReservationTiming();
    });
  });

  if (typeof compactCalendarMedia.addEventListener === "function") {
    compactCalendarMedia.addEventListener("change", applyResponsiveCalendarLayout);
  } else {
    compactCalendarMedia.addListener(applyResponsiveCalendarLayout);
  }

  [elements.bookingDialog, elements.detailsDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && backend.hasSession()) loadReservations({ quiet: true });
  });
}

async function initializeData() {
  await window.FAMILY_GARAGE_AUTH.initialize(async () => {
    const loaded = await loadReservations();
    if (!loaded) return false;
    window.clearInterval(syncTimer);
    syncTimer = window.setInterval(() => {
      if (!document.hidden && !loadInFlight) loadReservations({ quiet: true });
    }, 5000);
    return true;
  }, clearPrivateView);
}

function clearPrivateView() {
  latestLoadRequest += 1;
  window.clearInterval(syncTimer);
  syncTimer = null;
  reservations = [];
  selectedReservation = null;
  elements.bookingDialog.close();
  elements.detailsDialog.close();
  elements.notes.value = '';
  elements.detailNotes.textContent = '';
  elements.detailTime.textContent = '';
  elements.detailCar.textContent = '';
  elements.detailHeading.textContent = '';
  elements.calendar.removeAttribute('aria-busy');
  Object.values(reservationPickers).forEach((picker) => picker.close());
  refreshCalendar();
  setSyncStatus('Bitte anmelden', '#64748b');
}

async function loadReservations({ quiet = false } = {}) {
  const requestId = ++latestLoadRequest;
  if (!quiet) setSyncStatus("Kalender wird geladen", "#f59e0b");
  elements.calendar.setAttribute("aria-busy", "true");
  loadInFlight = true;
  try {
    const { data, error } = await backend.listReservations();
    if (requestId !== latestLoadRequest) return false;
    if (error) throw error;
    reservations = data || [];
    setSyncStatus("Automatisch synchronisiert", "#16a34a");
    refreshCalendar();
    return true;
  } catch (error) {
    if (requestId !== latestLoadRequest) return false;
    setSyncStatus("Synchronisierung nicht verfügbar", "#e11d48");
    if (!quiet) showToast('Kalender konnte nicht geladen werden. Bitte erneut versuchen.', "error");
    return false;
  } finally {
    loadInFlight = false;
    if (requestId === latestLoadRequest) elements.calendar.removeAttribute("aria-busy");
  }
}

function filteredCalendarEvents() {
  const car = elements.carFilter.value;
  const person = elements.personFilter.value;
  return reservations
    .filter((reservation) => (!car || reservation.car === car) && (!person || reservation.person === person))
    .map(toCalendarEvent);
}

function toCalendarEvent(reservation) {
  const car = carById(reservation.car);
  const allDay = isAllDayReservation(reservation);
  return {
    id: reservation.id,
    title: `${car.short} · ${reservation.person}`,
    start: allDay ? dateKeyInBerlin(new Date(reservation.start_time)) : reservation.start_time,
    end: allDay ? dateKeyInBerlin(new Date(reservation.end_time)) : reservation.end_time,
    allDay,
    backgroundColor: car.soft,
    borderColor: car.color,
    textColor: car.text,
    classNames: ["vehicle-event"],
    extendedProps: { reservationId: reservation.id, reservation },
  };
}

function renderEventContent(info) {
  const reservation = info.event.extendedProps.reservation;
  const car = carById(reservation.car);
  const compact = compactCalendarMedia.matches;
  const wrapper = document.createElement("div");
  const meta = document.createElement("span");
  const time = document.createElement("span");
  const person = document.createElement("span");

  wrapper.className = `reservation-event-content${compact ? " is-compact" : ""}`;
  meta.className = "event-meta";
  time.className = "event-time";
  person.className = "event-person";
  meta.textContent = compact ? car.compact : (info.event.allDay ? car.short : `${car.short} · ${info.timeText}`);
  time.textContent = info.event.allDay ? "Tag" : info.timeText;
  person.textContent = compact ? compactPersonName(reservation.person) : reservation.person;
  wrapper.append(meta, time, person);
  return { domNodes: [wrapper] };
}

function refreshCalendar() {
  calendar.refetchEvents();
  elements.emptyState.classList.toggle("hidden", filteredCalendarEvents().length !== 0);
}

function applyResponsiveCalendarLayout() {
  calendar.setOption("dayMaxEvents", compactCalendarMedia.matches ? 2 : false);
  if (compactCalendarMedia.matches && calendar.view.type === "timeGridWeek") calendar.changeView("timeGridDay");
  refreshCalendar();
}

function updateCalendarTitle(info) {
  elements.calendarTitle.textContent = info.view.title;
}

function openBooking({ date } = {}) {
  resetBookingForm();
  const initial = date instanceof Date ? date : new Date();
  const start = new Date(initial);
  if (date) {
    const hasSelectedTime = date.getHours() !== 0 || date.getMinutes() !== 0;
    start.setHours(hasSelectedTime ? date.getHours() : 8, hasSelectedTime ? date.getMinutes() : 0, 0, 0);
  } else {
    roundToNextHalfHour(start);
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  setPickerDate("startDateTime", start, formatDateTimeInput);
  setPickerDate("endDateTime", end, formatDateTimeInput);
  setPickerDate("startDate", start, formatDateInput);
  setPickerDate("endDate", start, formatDateInput);
  updateDateInputMode();
  elements.bookingDialog.showModal();
  window.setTimeout(() => elements.carSelect.focus(), 20);
}

function closeBooking() {
  elements.bookingDialog.close();
  clearFormMessage();
}

function resetBookingForm() {
  elements.bookingForm.reset();
  elements.allDay.checked = false;
  elements.saveButton.disabled = false;
  [elements.startDateTime, elements.endDateTime, elements.startDate, elements.endDate].forEach((input) => input.setAttribute("aria-invalid", "false"));
  clearFormMessage();
}

function setPickerDate(pickerName, date, fallbackFormatter) {
  const picker = reservationPickers[pickerName];
  if (picker) {
    picker.setDate(date, false);
    return;
  }
  const input = elements[pickerName];
  input.value = fallbackFormatter(date);
}

function updateDateInputMode() {
  const isAllDay = elements.allDay.checked;
  elements.timedFields.classList.toggle("hidden", isAllDay);
  elements.allDayFields.classList.toggle("hidden", !isAllDay);
  elements.datetimeFormatHint.classList.toggle("hidden", isAllDay);
  elements.allDayFormatHint.classList.toggle("hidden", !isAllDay);
  elements.startDateTime.required = !isAllDay;
  elements.endDateTime.required = !isAllDay;
  elements.startDate.required = isAllDay;
  elements.endDate.required = isAllDay;
  validateReservationTiming();
}

function reservationFromForm() {
  const car = elements.carSelect.value;
  const person = elements.personSelect.value;
  let start;
  let end;

  if (elements.allDay.checked) {
    start = localDateAtStart(elements.startDate.value);
    end = localDateAtStart(elements.endDate.value);
    if (end) end.setDate(end.getDate() + 1);
  } else {
    start = parseGermanDateTime(elements.startDateTime.value);
    end = parseGermanDateTime(elements.endDateTime.value);
  }

  return {
    car,
    person,
    start_time: start?.toISOString(),
    end_time: end?.toISOString(),
    is_all_day: elements.allDay.checked,
    notes: elements.notes.value.trim(),
  };
}

function validateReservationTiming() {
  clearFormMessage();
  setTimingValidity(false);
  const draft = reservationFromForm();
  if (!draft.car || !draft.start_time || !draft.end_time) return false;
  if (new Date(draft.end_time) <= new Date(draft.start_time)) {
    setTimingValidity(true);
    showFormMessage("Das Ende muss nach dem Beginn liegen.", "error");
    return false;
  }
  const collision = findConflict(draft);
  if (collision) {
    showFormMessage(`Nicht verfügbar: ${draft.car} ist in diesem Zeitraum bereits von ${collision.person} reserviert.`, "error");
    return false;
  }
  return true;
}

async function saveReservation(event) {
  event.preventDefault();
  const draft = reservationFromForm();
  if (!draft.car || !draft.person || !draft.start_time || !draft.end_time) {
    const formatHint = elements.allDay.checked ? "TT.MM.JJJJ" : "TT.MM.JJJJ, HH:MM";
    showFormMessage(`Bitte fülle Fahrzeug, Person sowie Beginn und Ende im Format ${formatHint} aus.`, "error");
    return;
  }
  if (new Date(draft.end_time) <= new Date(draft.start_time)) {
    showFormMessage("Das Ende muss nach dem Beginn liegen.", "error");
    return;
  }
  if (!validateReservationTiming()) return;

  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "Wird gespeichert …";

  try {
    const { error } = await backend.createReservation(draft);
    if (error) {
      if (error.code === "23P01") {
        showFormMessage("Diese Zeit wurde gerade von einer anderen Buchung belegt. Bitte wähle einen anderen Zeitraum.", "error");
        await loadReservations({ quiet: true });
        return;
      }
      throw error;
    }
    await loadReservations({ quiet: true });
    closeBooking();
    showToast("Reservierung gespeichert.");
  } catch (error) {
    showFormMessage(`Speichern fehlgeschlagen: ${error.message}`, "error");
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = "Reservierung speichern";
  }
}

function findConflict(candidate) {
  const candidateStart = new Date(candidate.start_time).getTime();
  const candidateEnd = new Date(candidate.end_time).getTime();
  return reservations.find((reservation) =>
    reservation.car === candidate.car &&
    new Date(reservation.start_time).getTime() < candidateEnd &&
    new Date(reservation.end_time).getTime() > candidateStart,
  );
}

function openDetails(reservationId) {
  selectedReservation = reservations.find((reservation) => reservation.id === reservationId);
  if (!selectedReservation) return;
  elements.detailCar.textContent = selectedReservation.car;
  elements.detailHeading.textContent = selectedReservation.person;
  elements.detailTime.textContent = formatReservationRange(selectedReservation);
  elements.detailNotes.textContent = selectedReservation.notes || "Keine Notiz hinterlegt.";
  elements.detailNotesGroup.classList.toggle("opacity-60", !selectedReservation.notes);
  elements.detailsDialog.showModal();
  window.setTimeout(() => elements.closeDetails.focus(), 20);
}

function closeDetails() {
  elements.detailsDialog.close();
  selectedReservation = null;
}

async function deleteReservation() {
  if (!selectedReservation) return;
  const reservation = selectedReservation;
  const confirmed = window.confirm(`Reservierung von ${reservation.person} für ${reservation.car} wirklich löschen?`);
  if (!confirmed) return;

  elements.deleteButton.disabled = true;
  elements.deleteButton.textContent = "Wird gelöscht …";
  try {
    const { error } = await backend.deleteReservation(reservation.id);
    if (error) throw error;
    await loadReservations({ quiet: true });
    closeDetails();
    showToast("Reservierung gelöscht.");
  } catch (error) {
    showToast(`Löschen fehlgeschlagen: ${error.message}`, "error");
  } finally {
    elements.deleteButton.disabled = false;
    elements.deleteButton.textContent = "Reservierung löschen";
  }
}

function formatReservationRange(reservation) {
  const start = new Date(reservation.start_time);
  const end = new Date(reservation.end_time);
  if (isAllDayReservation(reservation)) {
    const lastDay = new Date(end);
    lastDay.setDate(lastDay.getDate() - 1);
    const startText = formatDateInBerlin(start);
    const endText = formatDateInBerlin(lastDay);
    return startText === endText ? `Ganztägig · ${startText}` : `Ganztägig · ${startText} – ${endText}`;
  }
  const sameDay = dateKey(start) === dateKey(end);
  return sameDay
    ? `${formatDate(start)}, ${formatTime(start)}–${formatTime(end)} Uhr`
    : `${formatDate(start)}, ${formatTime(start)} Uhr – ${formatDate(end)}, ${formatTime(end)} Uhr`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(DE_LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatDateInBerlin(date) {
  return new Intl.DateTimeFormat(DE_LOCALE, {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat(DE_LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatDateInput(date) {
  return formatDate(date);
}

function formatDateTimeInput(date) {
  return `${formatDateInput(date)}, ${formatTime(date)}`;
}

function parseGermanDate(value) {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function parseGermanDateTime(value) {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[\s,]+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, dayText, monthText, yearText, hourText, minuteText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  const isValid = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute;
  return isValid ? date : null;
}

function normalizeDateInput(input) {
  const date = parseGermanDate(input.value);
  if (date) input.value = formatDateInput(date);
}

function normalizeDateTimeInput(input) {
  const date = parseGermanDateTime(input.value);
  if (date) input.value = formatDateTimeInput(date);
}

function setTimingValidity(invalid) {
  const activeInputs = elements.allDay.checked
    ? [elements.startDate, elements.endDate]
    : [elements.startDateTime, elements.endDateTime];
  activeInputs.forEach((input) => input.setAttribute("aria-invalid", String(invalid)));
}

function isAllDayReservation(reservation) {
  if (typeof reservation.is_all_day === "boolean") return reservation.is_all_day;
  const start = new Date(reservation.start_time);
  const end = new Date(reservation.end_time);
  return start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() === 0 && end.getMinutes() === 0;
}

function datetimeLocalValue(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateKey(date) {
  return datetimeLocalValue(date).slice(0, 10);
}

function dateKeyInBerlin(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localDateAtStart(value) {
  return parseGermanDate(value);
}

function roundToNextHalfHour(date) {
  const minutes = date.getMinutes();
  date.setSeconds(0, 0);
  if (minutes === 0 || minutes === 30) return;
  if (minutes < 30) {
    date.setMinutes(30);
    return;
  }
  date.setHours(date.getHours() + 1, 0, 0, 0);
}

function carById(id) {
  return CARS.find((car) => car.id === id) || CARS[0];
}

function compactPersonName(person) {
  return { Wilke: "Wil.", Wolfgang: "Wolf.", Anja: "Anja" }[person] || person.slice(0, 4);
}

function showFormMessage(message, type) {
  elements.formMessage.textContent = message;
  elements.formMessage.className = `rounded-xl px-3 py-2.5 text-sm font-medium ${type === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`;
}

function clearFormMessage() {
  elements.formMessage.textContent = "";
  elements.formMessage.className = "hidden rounded-xl px-3 py-2.5 text-sm font-medium";
}

function showToast(message, type = "success") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden", "bg-rose-700");
  if (type === "error") elements.toast.classList.add("bg-rose-700");
  toastTimer = window.setTimeout(() => elements.toast.classList.add("hidden"), 4500);
}

function setSyncStatus(message, color) {
  elements.syncStatus.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.style.backgroundColor = color;
  elements.syncStatus.append(dot, document.createTextNode(message));
}

initialize();
