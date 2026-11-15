import { events } from '../core/events';
import type { Rng } from '../core/math';
import type { RaceControlMessage, RaceState } from '../core/types';
import { MAX_MESSAGES } from './internal';

export type Voice = 'clipped' | 'warm' | 'passionate' | 'cool';

export const VOICE_BY_TEAM: Record<string, Voice> = {
  redline: 'clipped',
  northgate: 'warm',
  veloce: 'passionate',
  meridian: 'clipped',
  lionheart: 'warm',
  stratos: 'passionate',
  alpen: 'passionate',
  pacific: 'warm',
  axiom: 'cool',
  helvetia: 'cool',
};

export type RadioCategory =
  | 'start'
  | 'ack'
  | 'cancel'
  | 'box'
  | 'lap'
  | 'lapLead'
  | 'purple'
  | 'drs'
  | 'drsEnabled'
  | 'flag'
  | 'blue'
  | 'weather'
  | 'penalty'
  | 'warning'
  | 'tyres'
  | 'overtake'
  | 'overtaken'
  | 'pitEntry'
  | 'pitExit'
  | 'slowStop'
  | 'strategy'
  | 'incident'
  | 'vsc'
  | 'vscEnd'
  | 'retired'
  | 'chequered'
  | 'post'
  | 'fastest'
  | 'invalid'
  | 'finalLap';

const COOLDOWN: Record<RadioCategory, number> = {
  start: 0,
  ack: 0,
  cancel: 0,
  box: 0,
  lap: 20,
  lapLead: 20,
  purple: 30,
  drs: 75,
  drsEnabled: 0,
  flag: 12,
  blue: 30,
  weather: 30,
  penalty: 0,
  warning: 0,
  tyres: 110,
  overtake: 15,
  overtaken: 15,
  pitEntry: 0,
  pitExit: 0,
  slowStop: 0,
  strategy: 90,
  incident: 10,
  vsc: 0,
  vscEnd: 0,
  retired: 0,
  chequered: 0,
  post: 0,
  fastest: 30,
  invalid: 20,
  finalLap: 0,
};

const PRIORITY = new Set<RadioCategory>(['start', 'ack', 'cancel', 'box', 'penalty', 'warning', 'pitEntry', 'pitExit', 'slowStop', 'vsc', 'vscEnd', 'retired', 'chequered', 'post', 'finalLap', 'flag', 'incident']);

type Vars = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;
const fill = (template: string, vars: Vars): string => template.replace(PLACEHOLDER, (_m, k: string) => (vars[k] !== undefined ? String(vars[k]) : ''));
/** True when every placeholder in the template has a usable value (so "gap to {ahead}" is never said with nobody ahead). */
const satisfiable = (template: string, vars: Vars): boolean => {
  PLACEHOLDER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER.exec(template))) {
    const v = vars[m[1]];
    if (v === undefined || v === '' || v === '--') return false;
  }
  return true;
};

const LINES: Record<Voice, Partial<Record<RadioCategory, string[]>>> = {
  warm: {
    start: ['Lights out, go go go! Good launch, hold your line.', 'And away we go. Clean first lap, that is all we need.'],
    ack: ['Copy that, box this lap. {compound}s will be ready.', 'Understood, box box. We are going to the {compound}.'],
    cancel: ['Copy, staying out. Cancel the stop.', 'Okay, stay out, stay out. We will revisit next lap.'],
    box: ['Box this lap, box box. {compound}s are out.', 'Okay {name}, this is the lap. Box, box, {compound}s.'],
    lap: ["That's P{pos}, {lapTime}. Gap to {ahead} is {gap}.", 'P{pos}. {behind} is {gapBehind} behind, keep the pressure on.', 'Good lap, {lapTime}. We are P{pos}, {ahead} {gap} up the road.'],
    lapLead: ['P1, {lapTime}. {behind} is {gapBehind} behind. Keep it tidy.', 'Leading by {gapBehind} to {behind}. Manage the tyres, this is ours to lose.'],
    purple: ['Purple sector, keep it up!', 'That is the fastest sector of anyone, lovely stuff.'],
    drs: ['DRS enabled, you have it down the straight.', 'DRS is yours, use it.'],
    drsEnabled: ['DRS has been enabled race-wide.'],
    flag: ['{Kind} flag sector {sector}, no overtaking, ease off.', '{Kind} in sector {sector}, be careful through there.'],
    blue: ['Blue flags, {name}. Let {leader} through when it is safe.', 'Blue flag, the leaders are coming. Let them by, no fight.'],
    weather: ['{text}'],
    penalty: ['Bad news, {seconds} second penalty for {reason}. We will add it at the end.', 'Stewards have given us {seconds} seconds, {reason}. Keep your head down.'],
    warning: ['Warning from race control: {reason}. That is {count} of three, mind the limits.', 'Careful, that is a warning for {reason}.'],
    tyres: ['Tyres are {age} laps old now. Look after the rears out of the slow corners.', 'How are the tyres feeling? {age} laps on this set, still in the window on our numbers.'],
    overtake: ['Great move! P{pos} now.', 'Lovely, that is P{pos}. Now build the gap.'],
    overtaken: ['We lost a place to {other}, P{pos}. Stay with them, he will make a mistake.', '{other} got by, P{pos}. Do not panic, long race.'],
    pitEntry: ['In the pit lane, limiter on. Box is open, come in nice and straight.'],
    pitExit: ['Good stop, {duration}. You are out in P{pos}, push now, tyres are cold.', 'Out of the pits, P{pos}. Warm them up, careful on the first lap.'],
    slowStop: ['Hold, hold, problem on the {wheel}... okay go go go! Sorry mate.'],
    strategy: ['We are looking at boxing around lap {lap}. Tell us if the tyres go off before that.', 'Pit window opens in a couple of laps. Plan is {compound}s.'],
    incident: ['{other} has stopped on track, yellows in sector {sector}.', 'Incident ahead in sector {sector}, stay sharp.'],
    vsc: ['Virtual safety car, VSC. Slow to the delta, no overtaking.'],
    vscEnd: ['VSC ending, ending. Go go go when it goes green.'],
    retired: ['We have lost the car, {reason}. Pull over somewhere safe. Sorry mate.'],
    chequered: ['Last lap, last lap. Bring it home.'],
    finalLap: ['Final lap, {name}. Everything you have got.'],
    post: ['{postText}'],
    fastest: ['Fastest lap of the race, {lapTime}. Beautiful.'],
    invalid: ['That lap has been deleted, track limits. Keep it inside the white lines.'],
  },
  clipped: {
    start: ['Lights out. Go.', 'Green. Clean start.'],
    ack: ['Copy. Box this lap. {compound}.', 'Box box. {compound} ready.'],
    cancel: ['Copy. Stay out.'],
    box: ['Box box. {compound}.', 'Box this lap. {compound}s.'],
    lap: ['P{pos}. {lapTime}. Gap ahead {gap}.', 'P{pos}. {behind} plus {gapBehind}.', '{lapTime}. P{pos}. {ahead} at {gap}.'],
    lapLead: ['P1. {lapTime}. {behind} plus {gapBehind}.', 'Leading. Gap {gapBehind}. Manage.'],
    purple: ['Purple sector.', 'Purple. Keep going.'],
    drs: ['DRS enabled.', 'You have DRS.'],
    drsEnabled: ['DRS enabled race-wide.'],
    flag: ['{Kind} sector {sector}. Lift.', '{Kind} flag sector {sector}. Careful.'],
    blue: ['Blue flags. Let {leader} through.'],
    weather: ['{text}'],
    penalty: ['{seconds} second penalty. {Reason}.'],
    warning: ['Warning. {Reason}. {count} of three.'],
    tyres: ['Tyres {age} laps. Manage the fronts.', 'Tyre temps good. {age} laps on this set.'],
    overtake: ['P{pos}. Good.', 'P{pos}. Build the gap.'],
    overtaken: ['P{pos}. {other} through. Stay with him.'],
    pitEntry: ['In the lane. Limiter. Box is clear.'],
    pitExit: ['{duration} stop. P{pos}. Push.'],
    slowStop: ['Hold. Problem {wheel}. ... Go go go.'],
    strategy: ['Target stop lap {lap}. {compound}.'],
    incident: ['{other} stopped. Sector {sector}. Yellow.'],
    vsc: ['VSC. VSC. Delta.'],
    vscEnd: ['VSC ending.'],
    retired: ['{Reason}. Stop the car. Safe place.'],
    chequered: ['Last lap.'],
    finalLap: ['Final lap.'],
    post: ['{postText}'],
    fastest: ['Fastest lap. {lapTime}.'],
    invalid: ['Lap deleted. Track limits.'],
  },
  passionate: {
    start: ['Vai vai vai! Lights out, go!', 'Go go go! Great start, keep it clean!'],
    ack: ['Okay okay, box this lap, {compound}s, the boys are ready!', 'Si, box box! {compound}s waiting for you.'],
    cancel: ['Okay, stay out, stay out, we cancel!'],
    box: ['Box box box! {compound}s now!', 'Box this lap {name}, {compound}s, come on!'],
    lap: ['P{pos}! {lapTime}! {ahead} is {gap} ahead, we can get him!', 'Fantastic, P{pos}. {behind} is {gapBehind} behind, do not let him close!', '{lapTime}, P{pos}. Push push push!'],
    lapLead: ['P1! {lapTime}! {behind} is {gapBehind} behind, keep pushing!', 'We are leading! {gapBehind} to {behind}. Concentrate, concentrate!'],
    purple: ['PURPLE! Purple sector, incredible!', 'Fastest of everyone in that sector! Bravo!'],
    drs: ['DRS DRS! Use it, go!', 'You have DRS, get him!'],
    drsEnabled: ['DRS is enabled now, it is on!'],
    flag: ['{Kind} flag sector {sector}! Careful, careful!', '{Kind} in sector {sector}, no overtaking!'],
    blue: ['Blue flags {name}, let {leader} pass, do not lose time fighting!'],
    weather: ['{text}'],
    penalty: ['No no no... {seconds} seconds penalty, {reason}. We fight on!', 'Stewards give {seconds} seconds for {reason}. Madonna. Keep pushing.'],
    warning: ['Warning for {reason}! {count} of three, stay inside the lines please!'],
    tyres: ['Tyres are {age} laps, how do they feel? Take care of the rears!', '{age} laps on the tyres, still good on our data. Push!'],
    overtake: ['YES! What a move! P{pos}!', 'Bravo! P{pos}! Now go go go!'],
    overtaken: ['{other} passed us, P{pos}. Stay with him, he will make a mistake!'],
    pitEntry: ['In the pit lane, limiter, the box is open, come come!'],
    pitExit: ['Stop was {duration}, you are P{pos}! Push, tyres are cold!'],
    slowStop: ['Stop stop stop! Problem {wheel}! ... okay GO GO GO!'],
    strategy: ['Strategy is lap {lap}, {compound}s. Tell me about the tyres.'],
    incident: ['{other} is stopped in sector {sector}, be careful!'],
    vsc: ['VSC, VSC! Slow down to the delta, no overtaking!'],
    vscEnd: ['VSC is ending! Be ready!'],
    retired: ['No... {reason}. Stop the car, stop the car in a safe place. I am sorry.'],
    chequered: ['Last lap! Bring it home!'],
    finalLap: ['FINAL LAP {name}! Everything now!'],
    post: ['{postText}'],
    fastest: ['FASTEST LAP! {lapTime}! Incredible!'],
    invalid: ['Lap deleted, track limits. Stay inside the lines please!'],
  },
  cool: {
    start: ['Lights out. Nice and easy through turn one.', "Green flag. Let's go racing."],
    ack: ['Copy, box this lap. {compound}s.', 'Roger. Box box, {compound}.'],
    cancel: ['Copy, stay out.'],
    box: ['Box this lap. {compound}s ready.', 'Alright, box box. {compound}.'],
    lap: ['P{pos}, {lapTime}. {ahead} is {gap} up the road.', 'P{pos}. {behind} {gapBehind} behind. All under control.', '{lapTime}. P{pos}. Keep doing that.'],
    lapLead: ['P1, {lapTime}. {behind} {gapBehind} back. Cruise control.', 'Leading by {gapBehind}. Nothing silly now.'],
    purple: ['Purple sector. Nice.', 'That was quickest of anyone. Keep it rolling.'],
    drs: ['DRS available.', 'You have DRS.'],
    drsEnabled: ['DRS is enabled.'],
    flag: ['{Kind} in sector {sector}. Take it easy through there.'],
    blue: ['Blue flags. Let {leader} by, no drama.'],
    weather: ['{text}'],
    penalty: ['{seconds} seconds, {reason}. Nothing we can do, keep going.'],
    warning: ['Warning, {reason}. {count} of three. Watch the limits.'],
    tyres: ['{age} laps on the tyres. They look fine from here.', 'Tyres are {age} laps old. Manage the rears, keep the temps in.'],
    overtake: ['Nice one. P{pos}.', 'P{pos}. Clean move.'],
    overtaken: ['{other} is through, P{pos}. Stay calm, stay close.'],
    pitEntry: ['In the pit lane. Limiter on. Box is clear.'],
    pitExit: ['{duration}. Out in P{pos}. Cold tyres, careful.'],
    slowStop: ['Hold... problem on the {wheel}. Okay, go.'],
    strategy: ['Plan is lap {lap} for {compound}s. Let me know about the tyres.'],
    incident: ['{other} stopped in sector {sector}. Yellows.'],
    vsc: ['VSC. Slow to the delta.'],
    vscEnd: ['VSC ending shortly.'],
    retired: ['{Reason}. Stop the car somewhere safe. Unlucky.'],
    chequered: ['Last lap. Bring it home.'],
    finalLap: ['Final lap. All yours.'],
    post: ['{postText}'],
    fastest: ['Fastest lap. {lapTime}.'],
    invalid: ['Lap deleted for track limits.'],
  },
};

interface Queued {
  text: string;
  category: RadioCategory;
}

/** The player's race engineer: personality per team, category cooldowns, and a small queue so lines never overlap. */
export class TeamRadio {
  private readonly queue: Queued[] = [];
  private lastAt = -Infinity;
  private readonly lastCat: Partial<Record<RadioCategory, number>> = {};
  enabled = true;

  constructor(
    private readonly carId: number,
    private readonly voice: Voice,
    private readonly rng: Rng,
  ) {}

  /** Queue a line. Returns false when the category is on cooldown or the queue is full. */
  say(category: RadioCategory, now: number, vars: Vars = {}, force = false): boolean {
    if (!this.enabled) return false;
    const last = this.lastCat[category] ?? -Infinity;
    if (!force && now - last < COOLDOWN[category]) return false;
    const pool = LINES[this.voice][category] ?? LINES.warm[category];
    if (!pool || pool.length === 0) return false;
    for (const q of this.queue) if (q.category === category) return false;
    let candidates = pool.filter((t) => satisfiable(t, vars));
    if (candidates.length === 0) {
      if (category === 'lap' || category === 'lapLead') return false;
      candidates = pool;
    }
    const text = fill(this.rng.pick(candidates), vars);
    if (PRIORITY.has(category)) this.queue.unshift({ text, category });
    else {
      if (this.queue.length >= 3) return false;
      this.queue.push({ text, category });
    }
    this.lastCat[category] = now;
    return true;
  }

  update(now: number, race: RaceState): void {
    if (this.queue.length === 0) return;
    const head = this.queue[0];
    const spacing = PRIORITY.has(head.category) ? 1.2 : 5;
    if (now - this.lastAt < spacing) return;
    this.queue.shift();
    this.lastAt = now;
    events.emit('radio:message', { carId: this.carId, from: 'engineer', text: head.text });
    const m: RaceControlMessage = { time: now, text: head.text, kind: 'radio', carId: this.carId };
    race.messages.push(m);
    if (race.messages.length > MAX_MESSAGES) race.messages.splice(0, race.messages.length - MAX_MESSAGES);
  }

  clear(): void {
    this.queue.length = 0;
  }
}

/** Occasional flavour lines from other drivers (broadcast "team radio" cut-ins). */
export const DRIVER_LINES = {
  overtake: ['Yes! Got him!', 'Ha! See you later.', 'That was tight. Okay, okay.', 'Come on! Who is next?'],
  overtaken: ['He pushed me off! Did you see that?', 'Come on guys, I have no grip.', 'The tyres are gone, gone.'],
  pitExit: ['Good stop guys, thank you.', 'Okay, tyres feel good.', 'How many did we lose in the stop?'],
  retired: ['No power, no power. I have lost everything.', 'It is finished. Sorry guys.', 'Something broke, I am stopping.'],
  fastest: ['That felt good. Very good.', 'Car is on rails right now.'],
  penalty: ['Five seconds?! For what?', 'That is a joke. A joke.'],
  finish: ['YES! Thank you guys, thank you!', 'Great job everyone. Great job.', 'P{pos}. Solid points, well done all.', 'We will take that. Good weekend.'],
  weather: ['It is raining here, drops on the visor.', 'Track is very slippery in the last corner.'],
} as const;

export type DriverLineKind = keyof typeof DRIVER_LINES;
