const { isSupabaseConfigured, supabase: supabaseClient, configurationError } = window.FAMILY_GARAGE_BACKEND;

const CARS = [
  { id: "BMW 320d", short: "BMW", color: "#2563eb", soft: "#dbeafe", text: "#173d84" },
  { id: "Nissan Townstar", short: "Nissan", color: "#0f9b78", soft: "#d1fae5", text: "#075e4c" },
  { id: "Dethleffs Just 90", short: "Dethleffs", color: "#d97706", soft: "#fef3c7", text: "#8a4507" },
];
const PEOPLE = ["Wilke", "Wolfgang", "Anja"];
const LOCAL_STORAGE_KEY = "familiengarage-reservations-v1";
const DE_LOCALE = "de-DE";

const $ = (selector) => document.querySelector(selector);
const elements = {
  calendar: $("#calendar"),
  calendarTitle: $("#calendar-title"),
  carFilter: $("#filter-car"),
  personFilter: $("#filter-person"),
  emptyState: $("#empty-state"),
  setupNotice: $("#setup-notice"),
  syncStatus: $("#sync-status"),
  bookingDialog: $("#booking-dialog"),
  detailsDialog: $("#reservation-dialog"),
  bookingForm: $("#booking-form"),
  carSelect: $("#reservation-car"),
  personSelect: $("#reservation-person"),
  allDay: $("#all-day"),
  timedFields: $("#timed-fields"),
  allDayFields: $("#all-day-fields"),
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
  deleteButton: $("#delete-reservation"),
  toast: $("#toast"),
};

let reservations = [];
let calendar;
let selectedReservation = null;
let unsubscribeChannel = null;
let toastTimer;

function initialize() {
  populateSelects();
  renderLegend();
  configureCalendar();
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

function configureCalendar() {
  calendar = new FullCalendar.Calendar(elements.calendar, {
    locale: "de",
    firstDay: 1,
    initialView: "dayGridMonth",
    headerToolbar: false,
    height: "auto",
    fixedWeekCount: false,
    dayMaxEvents: false,
    nowIndicator: true,
    allDayText: "Ganztägig",
    buttonText: { today: "Heute" },
    eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
    views: {
      dayGridMonth: { dayMaxEventRows: false },
      timeGridWeek: { slotMinTime: "06:00:00", slotMaxTime: "23:00:00", slotDuration: "00:30:00" },
    },
    events: (info, successCallback) => successCallback(filteredCalendarEvents()),
    datesSet: updateCalendarTitle,
    dateClick: (info) => openBooking({ date: info.date }),
    eventClick: (info) => openDetails(info.event.extendedProps.reservationId),
    eventContent: renderEventContent,
    eventDidMount: (info) => {
      const reservation = info.event.extendedProps.reservation;
      info.el.title = `${reservation.car}: ${formatReservationRange(reservation)}${reservation.notes ? ` – ${reservation.notes}` : ""}`;
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
      const viewName = button.dataset.view;
      calendar.changeView(viewName);
      document.querySelectorAll("[data-view]").forEach((viewButton) => {
        const active = viewButton.dataset.view === viewName;
        viewButton.classList.toggle("is-active", active);
        viewButton.setAttribute("aria-pressed", String(active));
      });
    });
  });

  [elements.carSelect, elements.startDateTime, elements.endDateTime, elements.startDate, elements.endDate].forEach((input) => {
    input.addEventListener("change", validateReservationTiming);
  });

  [elements.bookingDialog, elements.detailsDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribeChannel) supabaseClient.removeChannel(unsubscribeChannel);
  });
}

async function initializeData() {
  if (isSupabaseConfigured) {
    setSyncStatus("Verbindung wird hergestellt", "#f59e0b");
    await loadReservations();
    subscribeToChanges();
  } else {
    elements.setupNotice.classList.remove("hidden");
    reservations = readLocalReservations();
    setSyncStatus(configurationError || "Lokaler Testmodus", configurationError ? "#e11d48" : "#94a3b8");
    refreshCalendar();
  }
}

async function loadReservations({ quiet = false } = {}) {
  if (!quiet) setSyncStatus("Kalender wird geladen", "#f59e0b");
  const { data, error } = await supabaseClient
    .from("reservations")
    .select("id, car, person, start_time, end_time, notes, created_at")
    .order("start_time", { ascending: true });

  if (error) {
    setSyncStatus("Synchronisierung nicht verfügbar", "#e11d48");
    showToast(`Daten konnten nicht geladen werden: ${error.message}`, "error");
    return;
  }
  reservations = data || [];
  setSyncStatus("Live synchronisiert", "#16a34a");
  refreshCalendar();
}

function subscribeToChanges() {
  unsubscribeChannel = supabaseClient
    .channel("familiengarage-reservations")
    .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () => loadReservations({ quiet: true }))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("Live synchronisiert", "#16a34a");
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setSyncStatus("Synchronisierung unterbrochen", "#e11d48");
    });
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
    title: reservation.person,
    start: allDay ? dateKey(new Date(reservation.start_time)) : reservation.start_time,
    end: allDay ? dateKey(new Date(reservation.end_time)) : reservation.end_time,
    allDay,
    backgroundColor: car.color,
    borderColor: car.color,
    textColor: "#ffffff",
    classNames: ["vehicle-event"],
    extendedProps: { reservationId: reservation.id, reservation },
  };
}

function renderEventContent(info) {
  const reservation = info.event.extendedProps.reservation;
  const car = carById(reservation.car);
  const wrapper = document.createElement("div");
  const meta = document.createElement("span");
  const person = document.createElement("span");

  wrapper.className = "reservation-event-content";
  meta.className = "event-meta";
  person.className = "event-person";
  meta.textContent = info.event.allDay ? car.short : `${car.short} · ${info.timeText}`;
  person.textContent = reservation.person;
  wrapper.append(meta, person);
  return { domNodes: [wrapper] };
}

function refreshCalendar() {
  calendar.refetchEvents();
  elements.emptyState.classList.toggle("hidden", filteredCalendarEvents().length !== 0);
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
  elements.startDateTime.value = datetimeLocalValue(start);
  elements.endDateTime.value = datetimeLocalValue(end);
  elements.startDate.value = dateKey(start);
  elements.endDate.value = dateKey(start);
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
  clearFormMessage();
}

function updateDateInputMode() {
  const isAllDay = elements.allDay.checked;
  elements.timedFields.classList.toggle("hidden", isAllDay);
  elements.allDayFields.classList.toggle("hidden", !isAllDay);
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
    start = elements.startDateTime.value ? new Date(elements.startDateTime.value) : null;
    end = elements.endDateTime.value ? new Date(elements.endDateTime.value) : null;
  }

  return {
    car,
    person,
    start_time: start?.toISOString(),
    end_time: end?.toISOString(),
    notes: elements.notes.value.trim(),
  };
}

function validateReservationTiming() {
  clearFormMessage();
  const draft = reservationFromForm();
  if (!draft.car || !draft.start_time || !draft.end_time || new Date(draft.end_time) <= new Date(draft.start_time)) return false;
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
    showFormMessage("Bitte fülle Fahrzeug, Person sowie Beginn und Ende aus.", "error");
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
    if (isSupabaseConfigured) {
      const remoteConflict = await findRemoteConflict(draft);
      if (remoteConflict) {
        showFormMessage(`Nicht verfügbar: ${draft.car} wurde gerade von ${remoteConflict.person} reserviert.`, "error");
        return;
      }
      const { error } = await supabaseClient.from("reservations").insert(draft);
      if (error) {
        if (error.code === "23P01") {
          showFormMessage("Diese Zeit wurde gerade von einer anderen Buchung belegt. Bitte wähle einen anderen Zeitraum.", "error");
          await loadReservations({ quiet: true });
          return;
        }
        throw error;
      }
      await loadReservations({ quiet: true });
    } else {
      const saved = { ...draft, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      reservations = [...reservations, saved].sort(sortByStart);
      writeLocalReservations(reservations);
      refreshCalendar();
    }
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

async function findRemoteConflict(candidate) {
  const { data, error } = await supabaseClient
    .from("reservations")
    .select("id, person")
    .eq("car", candidate.car)
    .lt("start_time", candidate.end_time)
    .gt("end_time", candidate.start_time)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
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
  window.setTimeout(() => elements.deleteButton.focus(), 20);
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
    if (isSupabaseConfigured) {
      const { error } = await supabaseClient.from("reservations").delete().eq("id", reservation.id);
      if (error) throw error;
      await loadReservations({ quiet: true });
    } else {
      reservations = reservations.filter((item) => item.id !== reservation.id);
      writeLocalReservations(reservations);
      refreshCalendar();
    }
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
    const startText = formatDate(start);
    const endText = formatDate(lastDay);
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

function formatTime(date) {
  return new Intl.DateTimeFormat(DE_LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function isAllDayReservation(reservation) {
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

function localDateAtStart(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
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

function readLocalReservations() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY));
    return Array.isArray(stored) ? stored.sort(sortByStart) : [];
  } catch {
    return [];
  }
}

function writeLocalReservations(items) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
}

function sortByStart(first, second) {
  return new Date(first.start_time) - new Date(second.start_time);
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
