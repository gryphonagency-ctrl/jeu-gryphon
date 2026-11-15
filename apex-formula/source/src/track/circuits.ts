/**
 * Additional circuits authored by the track module (Agent 2). Same raw-point style as core/circuits.ts:
 * top-down picture +X right / +Z down the page, control point 0 = S/F line, travel starts heading +Z, left turns increase heading.
 * All five were validated (no self-intersection, min corner radius >= 18 m, max grade <= 9 %, pit lane 590 m, grid on the straight).
 */
import { buildControlPoints } from '../core/circuits';
import type { TrackDefinition } from '../core/types';

/**
 * PORTO AZZURRO — harbour-city night race. A 1 km harbour-front straight past the superyachts, tight 90-degree corners between the palazzi,
 * a long run along the Viale into a tunnel under the fortress, then a fast chicane at the yacht club back onto the waterfront.
 */
export const PORTO_AZZURRO: TrackDefinition = {
  id: 'porto-azzurro',
  name: 'Porto Azzurro Street Circuit',
  grandPrixName: 'Porto Azzurro Grand Prix',
  country: 'IT',
  location: 'Porto Azzurro, Ligurian Riviera',
  defaultWidth: 12,
  controlPoints: buildControlPoints(
    [
      [0, 0, 0, {width: 14, barrierL: 9.6, barrierR: 26}], // 0 S/F
      [0, 0, 260, {width: 14, barrierL: 9.6, barrierR: 26}], // 1 pitExit
      [0, 0, 300, {width: 14, barrierL: 9.6, barrierR: 26, kerbR: true}], // 2 end of harbour straight
      [-8.8, 0, 321.2, {width: 12, kerbR: true, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 3 Marina (1/2)
      [-30, 0, 330, {width: 12, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 4 Marina (2/2)
      [-80, 0, 330, {barrierL: 8.6, barrierR: 8.6}], // 5
      [-170, 0, 330, {barrierL: 8.6, barrierR: 8.6}], // 6
      [-260, 0, 330, {kerbR: true, width: 12, barrierL: 8.6, barrierR: 8.6}], // 7
      [-277.2, 0, 328.3, {width: 12, kerbR: true, barrierL: 8.6, barrierR: 8.6}], // 8 Curva del Molo (1/2)
      [-293.7, 0, 323.4, {width: 12, barrierL: 8.6, barrierR: 8.6}], // 9 Curva del Molo (2/2)
      [-310.3, 0, 318.5, {width: 12, kerbR: true, barrierL: 8.6, barrierR: 8.6}], // 10
      [-327.4, 0, 316.9, {width: 12, kerbR: true, barrierL: 8.6, barrierR: 8.6}], // 11
      [-377.4, 0, 316.9, {barrierL: 8.6, barrierR: 8.6}], // 12
      [-467.4, 0, 316.9, {barrierL: 8.6, barrierR: 8.6}], // 13
      [-557.4, 0, 316.9, {kerbR: true, width: 12, barrierL: 8.6, barrierR: 8.6}], // 14
      [-578.6, 0, 308.1, {width: 12, kerbR: true, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 15 Dogana (1/2)
      [-587.4, 0, 286.9, {width: 12, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 16 Dogana (2/2)
      [-587.4, 0.4, 236.9, {barrierL: 8.6, barrierR: 8.6}], // 17
      [-587.4, 1.2, 131.9, {barrierL: 8.6, barrierR: 8.6}], // 18
      [-587.4, 2, 26.9, {kerbL: true, width: 11, barrierL: 8.1, barrierR: 8.1}], // 19
      [-594.5, 2, 9.9, {width: 11, kerbL: true, kerbR: true, barrierL: 8.1, barrierR: 8.1}], // 20 Via Roma (1/2)
      [-611.4, 2, 2.9, {width: 11, kerbR: true, barrierL: 8.1, barrierR: 8.1}], // 21 Via Roma (2/2)
      [-651.4, 2, 2.9, {barrierL: 8.6, barrierR: 8.6}], // 22
      [-761.4, 2, 2.9, {barrierL: 8.6, barrierR: 8.6}], // 23
      [-871.4, 2, 2.9, {kerbR: true, width: 11, barrierL: 8.1, barrierR: 8.1}], // 24
      [-888.4, 2, -4.1, {width: 11, kerbR: true, kerbL: true, barrierL: 8.1, barrierR: 8.1}], // 25 Piazza (1/2)
      [-895.4, 2, -21.1, {width: 11, kerbL: true, barrierL: 8.1, barrierR: 8.1}], // 26 Piazza (2/2)
      [-895.4, 2.2, -71.1, {barrierL: 8.6, barrierR: 8.6}], // 27
      [-895.4, 2.6, -166.1, {barrierL: 8.6, barrierR: 8.6}], // 28
      [-895.4, 3, -261.1, {kerbL: true, width: 12, barrierL: 8.6, barrierR: 8.6}], // 29
      [-902.1, 3, -286.1, {width: 12, kerbL: true, kerbR: true, barrierL: 8.6, barrierR: 8.6}], // 30 Cattedrale (1/2)
      [-920.4, 3, -304.4, {width: 12, kerbR: true, barrierL: 8.6, barrierR: 8.6}], // 31 Cattedrale (2/2)
      [-963.7, 3, -329.4, {barrierL: 8.6, barrierR: 8.6}], // 32
      [-1028.7, 3, -366.9, {barrierL: 8.6, barrierR: 8.6}], // 33
      [-1093.6, 3, -404.4, {kerbR: true, width: 12, barrierL: 8.6, barrierR: 8.6}], // 34
      [-1111.9, 3, -422.7, {width: 12, kerbR: true, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 35 Teatro (1/2)
      [-1118.6, 3, -447.7, {width: 12, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 36 Teatro (2/2)
      [-1118.6, 3, -497.7, {barrierL: 8.6, barrierR: 8.6}], // 37
      [-1118.6, 3, -567.7, {barrierL: 8.6, barrierR: 8.6}], // 38 drs2det
      [-1118.6, 3, -627.7, {barrierL: 8.6, barrierR: 8.6}], // 39 drs2start
      [-1118.6, 3, -721, {barrierL: 8.6, barrierR: 8.6}], // 40
      [-1118.6, 3, -814.4, {barrierL: 8.6, barrierR: 8.6}], // 41
      [-1118.6, 3, -907.7, {kerbR: true, width: 12, barrierL: 8.6, barrierR: 8.6}], // 42
      [-1108.1, 3, -933.2, {width: 12, kerbR: true, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 43 Fortezza (1/2)
      [-1082.6, 3, -943.7, {width: 12, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 44 Fortezza (2/2)
      [-1032.6, 2.7, -943.7, {barrierL: 8.6, barrierR: 8.6}], // 45
      [-929.8, 2.1, -943.7, {barrierL: 8.6, barrierR: 8.6}], // 46
      [-827, 1.5, -943.7, {barrierL: 8.6, barrierR: 8.6}], // 47
      [-724.2, 0.9, -943.7, {barrierL: 8.6, barrierR: 8.6}], // 48
      [-621.4, 0.2, -943.7, {barrierL: 8.6, barrierR: 8.6}], // 49
      [-518.5, -0.4, -943.7, {barrierL: 8.6, barrierR: 8.6}], // 50
      [-415.7, -1, -943.7, {width: 11, barrierL: 8.1, barrierR: 8.1}], // 51 tunnel entry
      [-389.7, -1, -940.9, {width: 11, barrierL: 8.1, barrierR: 8.1}], // 52 Galleria (1/2)
      [-365, -1, -932.5, {width: 11, barrierL: 8.1, barrierR: 8.1}], // 53 Galleria (2/2)
      [-283.4, -0.6, -894.4, {barrierL: 8.6, barrierR: 8.6}], // 54 tunnelOut
      [-224.5, -0.3, -867, {barrierL: 8.6, barrierR: 8.6}], // 55
      [-165.6, 0, -839.5, {kerbL: true, width: 12, barrierL: 8.6, barrierR: 8.6}], // 56 tunnel exit
      [-155, 0, -836.9, {width: 12, kerbL: true, kerbR: true, barrierL: 8.6, barrierR: 8.6}], // 57 Chicane del Porto (1/2)
      [-144.2, 0, -838.6, {width: 12, kerbR: true, barrierL: 8.6, barrierR: 8.6}], // 58 Chicane del Porto (2/2)
      [-133.4, 0, -840.2, {width: 12, kerbR: true, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 59 Chicane del Porto (1/2)
      [-122.8, 0, -837.6, {width: 12, kerbL: true, barrierL: 8.6, barrierR: 8.6}], // 60 Chicane del Porto (2/2)
      [-86.5, 0, -820.7, {barrierL: 8.6, barrierR: 8.6}], // 61
      [-23.1, 0, -791.1, {kerbR: true, width: 13, barrierL: 9.1, barrierR: 9.1}], // 62
      [-6.3, 0, -776.4, {width: 13, kerbR: true, kerbL: true, barrierL: 9.1, barrierR: 9.1}], // 63 Yacht Club (1/2)
      [0, 0, -754.9, {width: 13, kerbL: true, barrierL: 9.1, barrierR: 9.1}], // 64 Yacht Club (2/2)
      [0, 0, -648.7, {width: 14, barrierL: 9.6, barrierR: 26}], // 65
      [0, 0, -542.4, {width: 14, barrierL: 9.6, barrierR: 26}], // 66
      [0, 0, -436.2, {width: 14, barrierL: 9.6, barrierR: 26}], // 67
      [0, 0, -330, {width: 14, barrierL: 9.6, barrierR: 26}], // 68 pit entry
    ],
  ),
  sectorEndCps: [25, 48],
  pitLane: { entryCp: 68, exitCp: 1, side: -1 },
  drsZones: [
    { detectionCp: 63, startCp: 68, endCp: 2 },
    { detectionCp: 38, startCp: 39, endCp: 42 },
  ],
  corners: [
    { cp: 3, name: 'Marina' },
    { cp: 8, name: 'Curva del Molo' },
    { cp: 15, name: 'Dogana' },
    { cp: 20, name: 'Via Roma' },
    { cp: 25, name: 'Piazza' },
    { cp: 30, name: 'Cattedrale' },
    { cp: 35, name: 'Teatro' },
    { cp: 43, name: 'Fortezza' },
    { cp: 52, name: 'Galleria' },
    { cp: 57, name: 'Chicane del Porto' },
    { cp: 59, name: 'Chicane del Porto' },
    { cp: 63, name: 'Yacht Club' },
  ],
  poleSide: -1,
  defaultLaps: 12,
  referenceLapTime: 80,
  environment: {
    theme: 'street',
    timeOfDay: 21,
    weather: 'dry',
    vibe: 'Harbour-city night race: floodlit streets between pastel palazzi, superyachts moored along the pit straight, a tunnel under the old fortress, neon on the water',
  },
  description: 'A floodlit dash through a Ligurian harbour town: 90-degree street corners, a kilometre-long harbour front, a tunnel under the fortress and a blind chicane at the yacht club.',
};

/**
 * AL SAHRA — desert dusk. Two slow corners by the paddock, a fast double sweeper over the dunes, a 1.2 km straight into the Oasis Hairpin,
 * then a flowing return through Mirage, Caravan and the Esses.
 */
export const AL_SAHRA: TrackDefinition = {
  id: 'al-sahra',
  name: 'Al Sahra International Circuit',
  grandPrixName: 'Al Sahra Grand Prix',
  country: 'AE',
  location: 'Al Sahra, Arabian Desert',
  defaultWidth: 14,
  controlPoints: buildControlPoints(
    [
      [0, 0, 0, {width: 15, barrierL: 30}], // 0 S/F
      [0, 0, 260, {width: 15, barrierL: 30}], // 1 pitExit
      [0, 0, 340, {width: 15, barrierL: 30, kerbL: true}], // 2
      [12.3, 0, 369.7, {width: 15, kerbL: true, kerbR: true}], // 3 Al Nakheel (1/2)
      [42, 0, 382, {width: 15, kerbR: true}], // 4 Al Nakheel (2/2)
      [92, 0, 382], // 5
      [157, 0, 382], // 6
      [222, 0, 382, {kerbL: true, width: 14}], // 7
      [247.5, 0, 371.5, {width: 14, kerbL: true, kerbR: true}], // 8 Souq (1/2)
      [258, 0, 346, {width: 14, kerbR: true}], // 9 Souq (2/2)
      [258, 0.8, 296], // 10
      [258, 2.2, 202.7], // 11
      [258, 3.6, 109.3], // 12
      [258, 5, 16, {kerbR: true, runoffL: 'gravel', width: 14}], // 13
      [274.1, 5, -22.9, {width: 14, kerbR: true, kerbL: true, runoffL: 'gravel'}], // 14 Falcon (1/2)
      [313, 5, -39, {width: 14, kerbL: true, runoffL: 'gravel'}], // 15 Falcon (2/2)
      [374.2, 5, -51.2, {width: 14, kerbR: true}], // 16 Sweeper (1/2)
      [426.1, 5, -85.9, {width: 14, kerbR: true}], // 17 Sweeper (2/2)
      [468.6, 5.8, -128.3], // 18
      [525.1, 6.9, -184.9], // 19
      [581.7, 8, -241.4, {width: 14}], // 20
      [623.9, 8, -269.6, {width: 14, kerbL: true}], // 21 Dunes (1/2)
      [673.6, 8, -279.5, {width: 14, kerbL: true}], // 22 Dunes (2/2)
      [733.6, 7.6, -279.5, {barrierL: 24}], // 23
      [973.6, 6, -279.5, {barrierL: 24}], // 24 drs2det
      [1123.6, 5, -279.5, {barrierL: 24}], // 25 drs2start
      [1273.6, 4, -279.5, {barrierL: 24}], // 26
      [1423.6, 3, -279.5, {barrierL: 24}], // 27
      [1573.6, 2, -279.5, {barrierL: 24}], // 28
      [1723.6, 1, -279.5, {barrierL: 24}], // 29
      [1873.6, 0, -279.5, {barrierL: 24, kerbL: true, runoffR: 'gravel', width: 16}], // 30 end of long straight
      [1896.3, 0, -288.9, {barrierL: 14, width: 16, kerbL: true, runoffR: 'gravel'}], // 31 Oasis Hairpin (1/4)
      [1905.6, 0, -311.5, {barrierL: 14, width: 16, kerbL: true, kerbR: true, runoffR: 'gravel'}], // 32 Oasis Hairpin (2/4)
      [1896.3, 0, -334.1, {barrierL: 14, width: 16, kerbL: true, kerbR: true, runoffR: 'gravel'}], // 33 Oasis Hairpin (3/4)
      [1873.6, 0, -343.5, {barrierL: 14, width: 16, kerbR: true, runoffR: 'gravel'}], // 34 Oasis Hairpin (4/4)
      [1813.6, 0.1, -343.5, {barrierL: 24}], // 35
      [1706.6, 0.4, -343.5, {barrierL: 24}], // 36
      [1599.5, 0.6, -343.5, {barrierL: 24}], // 37
      [1492.5, 0.8, -343.5, {barrierL: 24}], // 38
      [1385.4, 1.1, -343.5, {barrierL: 24}], // 39
      [1278.4, 1.3, -343.5, {barrierL: 24}], // 40
      [1171.4, 1.5, -343.5, {barrierL: 24}], // 41
      [1064.3, 1.8, -343.5, {barrierL: 24}], // 42
      [957.3, 2, -343.5, {barrierL: 24, kerbR: true, width: 14}], // 43
      [892.3, 2, -360.9, {width: 14, kerbR: true, kerbL: true}], // 44 Mirage (1/2)
      [844.7, 2, -408.5, {width: 14, kerbL: true}], // 45 Mirage (2/2)
      [819.7, 2, -451.8], // 46
      [764.7, 2, -547.1, {kerbL: true, width: 14}], // 47
      [733.6, 2, -578.2, {width: 14, kerbL: true, kerbR: true}], // 48 Caravan (1/2)
      [691.1, 2, -589.6, {width: 14, kerbR: true}], // 49 Caravan (2/2)
      [641.1, 1.7, -589.6], // 50
      [557.7, 1.1, -589.6], // 51
      [474.4, 0.6, -589.6], // 52
      [391.1, 0, -589.6, {kerbL: true, width: 13}], // 53
      [362.4, 0, -583.9, {width: 13, kerbL: true, kerbR: true}], // 54 The Esses (1/2)
      [338, 0, -567.6, {width: 13, kerbR: true}], // 55 The Esses (2/2)
      [313.7, 0, -551.3, {width: 13, kerbR: true, kerbL: true}], // 56 The Esses (1/2)
      [285, 0, -545.6, {width: 13, kerbL: true}], // 57 The Esses (2/2)
      [235, 0, -545.6], // 58
      [140, 0, -545.6], // 59
      [45, 0, -545.6, {kerbL: true, runoffR: 'gravel', width: 15}], // 60
      [13.2, 0, -532.5, {width: 15, kerbL: true, kerbR: true, runoffR: 'gravel'}], // 61 Sahra (1/2)
      [0, 0, -500.6, {width: 15, kerbR: true, runoffR: 'gravel'}], // 62 Sahra (2/2)
      [0, 0, -415.3, {width: 15, barrierL: 30}], // 63
      [0, 0, -330, {width: 15, barrierL: 30}], // 64 pit entry
    ],
  ),
  sectorEndCps: [24, 41],
  pitLane: { entryCp: 64, exitCp: 1, side: 1 },
  drsZones: [
    { detectionCp: 61, startCp: 64, endCp: 2 },
    { detectionCp: 24, startCp: 25, endCp: 30 },
  ],
  corners: [
    { cp: 3, name: 'Al Nakheel' },
    { cp: 8, name: 'Souq' },
    { cp: 14, name: 'Falcon' },
    { cp: 16, name: 'Sweeper' },
    { cp: 21, name: 'Dunes' },
    { cp: 32, name: 'Oasis Hairpin' },
    { cp: 44, name: 'Mirage' },
    { cp: 48, name: 'Caravan' },
    { cp: 54, name: 'The Esses' },
    { cp: 56, name: 'The Esses' },
    { cp: 61, name: 'Sahra' },
  ],
  poleSide: 1,
  defaultLaps: 10,
  referenceLapTime: 85,
  environment: {
    theme: 'desert',
    timeOfDay: 18.4,
    weather: 'dry',
    vibe: 'High desert at dusk: orange sky over rolling dunes, floodlight masts warming up, a glass hotel tower and a palm oasis by the hairpin, heat shimmer on the 1.2 km straight',
  },
  description: 'A modern desert showpiece at dusk. Fast sweepers feed a 1.2 km straight into the Oasis Hairpin, with wide asphalt run-off and a flowing final sector.',
};

/**
 * RIVIERA — coastal. Seafront straight, a climb through the pines (Les Lacets), a plateau run to the Col, the Corniche ridge road,
 * the cliff-top hairpin and a steep plunge back down to the Casino.
 */
export const RIVIERA: TrackDefinition = {
  id: 'riviera',
  name: 'Circuit de la Riviera',
  grandPrixName: 'Riviera Grand Prix',
  country: 'FR',
  location: "Cap Azur, Côte d'Azur",
  defaultWidth: 12,
  controlPoints: buildControlPoints(
    [
      [0, 0, 0, {width: 13, barrierL: 26, barrierR: 14}], // 0 S/F
      [0, 0, 260, {width: 13, barrierL: 26, barrierR: 14}], // 1 pitExit
      [0, 0, 380, {width: 13, barrierL: 26, barrierR: 14, kerbL: true}], // 2 seafront
      [11.1, 0, 406.9, {width: 12, kerbL: true, kerbR: true}], // 3 Port Corner (1/2)
      [38, 0, 418, {width: 12, kerbR: true}], // 4 Port Corner (2/2)
      [88, 1.5, 418], // 5
      [193, 4.8, 418], // 6
      [298, 8, 418, {kerbL: true, width: 12}], // 7
      [332.4, 10, 411.1, {width: 12, kerbL: true, kerbR: true}], // 8 La Montée (1/2)
      [361.6, 12, 391.6, {width: 12, kerbR: true}], // 9 La Montée (2/2)
      [397, 14.5, 356.3], // 10
      [450, 18.3, 303.3], // 11
      [503.1, 22, 250.2, {kerbL: true, width: 12}], // 12
      [517.7, 23.5, 233.4, {width: 12, kerbL: true}], // 13 Les Lacets (1/2)
      [529.9, 25, 214.7, {width: 12}], // 14 Les Lacets (2/2)
      [542, 26.5, 195.9, {width: 12, kerbL: true}], // 15
      [556.7, 28, 179.1, {width: 12, kerbL: true}], // 16
      [592, 30, 143.7], // 17
      [645.1, 33, 90.7], // 18
      [698.1, 36, 37.7, {kerbR: true, width: 12}], // 19
      [720.8, 37, 22.5, {width: 12, kerbR: true, kerbL: true}], // 20 Belvédère (1/2)
      [747.6, 38, 17.2, {width: 12, kerbL: true}], // 21 Belvédère (2/2)
      [797.6, 38.7, 17.2], // 22
      [880.9, 39.8, 17.2], // 23
      [964.3, 40.9, 17.2], // 24
      [1047.6, 42, 17.2, {kerbL: true, runoffR: 'gravel', width: 12}], // 25
      [1070.2, 42, 7.8, {width: 12, kerbL: true, kerbR: true, runoffR: 'gravel'}], // 26 Chapelle (1/2)
      [1079.6, 42, -14.8, {width: 12, kerbR: true, runoffR: 'gravel'}], // 27 Chapelle (2/2)
      [1079.6, 42.3, -64.8], // 28
      [1079.6, 42.8, -174.8], // 29 drs2det
      [1079.6, 43.2, -244.8], // 30 drs2start
      [1079.6, 43.8, -350.8], // 31
      [1079.6, 44.3, -456.8], // 32
      [1079.6, 44.9, -562.8], // 33
      [1079.6, 45.4, -668.8], // 34
      [1079.6, 46, -774.8, {kerbL: true, width: 12}], // 35 crest
      [1065.5, 45, -808.8, {width: 12, kerbL: true, kerbR: true}], // 36 Col (1/2)
      [1031.6, 44, -822.8, {width: 12, kerbR: true}], // 37 Col (2/2)
      [981.6, 43.1, -822.8], // 38
      [874.4, 41, -822.8], // 39
      [767.2, 39, -822.8, {width: 12}], // 40 ridge road
      [732.7, 38, -820.1, {width: 12}], // 41 Corniche (1/2)
      [699.2, 37, -812.1, {width: 12}], // 42 Corniche (2/2)
      [665.6, 36, -804, {width: 12}], // 43
      [631.2, 35, -801.3, {width: 12}], // 44
      [581.2, 34.5, -801.3], // 45
      [490.1, 33.7, -801.3], // 46
      [399.1, 32.8, -801.3], // 47
      [308, 32, -801.3, {kerbR: true, width: 12}], // 48
      [284, 31, -811.3, {width: 12, kerbR: true, kerbL: true}], // 49 Falaise (1/2)
      [274, 30, -835.3, {width: 12, kerbL: true}], // 50 Falaise (2/2)
      [274, 29.1, -875.3], // 51
      [274, 27, -965.3, {kerbL: true, runoffR: 'gravel', width: 13}], // 52
      [267, 26, -982.3, {width: 13, kerbL: true, runoffR: 'gravel'}], // 53 Épingle de la Falaise (1/4)
      [250, 25, -989.3, {width: 13, kerbL: true, kerbR: true, runoffR: 'gravel'}], // 54 Épingle de la Falaise (2/4)
      [233, 24, -982.3, {width: 13, kerbL: true, kerbR: true, runoffR: 'gravel'}], // 55 Épingle de la Falaise (3/4)
      [226, 23, -965.3, {width: 13, kerbR: true, runoffR: 'gravel'}], // 56 Épingle de la Falaise (4/4)
      [226, 19.8, -905.3], // 57
      [226, 14.2, -798.6], // 58
      [226, 8.6, -692], // 59
      [226, 3, -585.3, {kerbR: true, width: 12}], // 60 the plunge
      [214.3, 1.5, -557, {width: 12, kerbR: true, kerbL: true}], // 61 Descente (1/2)
      [186, 0, -545.3, {width: 12, kerbL: true}], // 62 Descente (2/2)
      [136, -0.7, -545.3], // 63
      [36, -2, -545.3, {kerbL: true, width: 13}], // 64
      [10.5, -2, -534.8, {width: 13, kerbL: true, kerbR: true}], // 65 Casino (1/2)
      [0, -2, -509.3, {width: 13, kerbR: true}], // 66 Casino (2/2)
      [0, -1, -419.7, {width: 13, barrierL: 26, barrierR: 14}], // 67
      [0, 0, -330, {width: 13, barrierL: 26, barrierR: 14}], // 68 pit entry
    ],
  ),
  sectorEndCps: [24, 47],
  pitLane: { entryCp: 68, exitCp: 1, side: 1 },
  drsZones: [
    { detectionCp: 65, startCp: 68, endCp: 2 },
    { detectionCp: 29, startCp: 30, endCp: 35 },
  ],
  corners: [
    { cp: 3, name: 'Port Corner' },
    { cp: 8, name: 'La Montée' },
    { cp: 13, name: 'Les Lacets' },
    { cp: 20, name: 'Belvédère' },
    { cp: 26, name: 'Chapelle' },
    { cp: 36, name: 'Col' },
    { cp: 41, name: 'Corniche' },
    { cp: 49, name: 'Falaise' },
    { cp: 54, name: 'Épingle de la Falaise' },
    { cp: 61, name: 'Descente' },
    { cp: 65, name: 'Casino' },
  ],
  poleSide: 1,
  defaultLaps: 12,
  referenceLapTime: 76,
  environment: {
    theme: 'coastal',
    timeOfDay: 16.2,
    weather: 'dry',
    vibe: 'Mediterranean afternoon: turquoise sea on the right of the pit straight, umbrella pines and villas on the hillside, a cliff-top hairpin high above the bay, late golden light',
  },
  description: 'From the seafront up through the pines to a cliff-side hairpin 45 m above the bay, then a plunge back down to the casino. Undulating, unforgiving, beautiful.',
};

/**
 * SCHWARZWALD RING — forest with big elevation. A tight first corner, a steep climb through Wasserfall into the blind Hochsprung crest,
 * a plateau along the forest to the Hexenkessel esses, then the Flugplatz plunge and a fast run home.
 */
export const SCHWARZWALD: TrackDefinition = {
  id: 'schwarzwald',
  name: 'Schwarzwald Ring',
  grandPrixName: 'Schwarzwald Grand Prix',
  country: 'DE',
  location: 'Titisee, Black Forest',
  defaultWidth: 13,
  controlPoints: buildControlPoints(
    [
      [0, 0, 0, {width: 14, barrierR: 26}], // 0 S/F
      [0, 0, 260, {width: 14, barrierR: 26}], // 1 pitExit
      [0, 0, 340, {width: 14, barrierR: 26, kerbR: true, runoffL: 'gravel'}], // 2
      [-8.8, 0, 361.2, {width: 14, kerbR: true, kerbL: true, runoffL: 'gravel'}], // 3 Schlosskurve (1/2)
      [-30, 0, 370, {width: 14, kerbL: true, runoffL: 'gravel'}], // 4 Schlosskurve (2/2)
      [-80, 1, 370], // 5
      [-155, 2.5, 370], // 6
      [-230, 4, 370, {kerbR: true, width: 14}], // 7
      [-253.5, 5, 368.2, {width: 14, kerbR: true}], // 8 Bärenkurve (1/2)
      [-276.4, 6, 362.7, {width: 14}], // 9 Bärenkurve (2/2)
      [-299.2, 7, 357.2, {width: 14, kerbR: true}], // 10
      [-322.7, 8, 355.3, {width: 14, kerbR: true}], // 11
      [-372.7, 9, 355.3], // 12
      [-447.7, 10.5, 355.3], // 13
      [-522.7, 12, 355.3, {width: 13}], // 14
      [-561.8, 15, 361.3, {width: 13, kerbR: true}], // 15 Wasserfall (1/2)
      [-597.3, 18, 378.8, {width: 13, kerbR: true}], // 16 Wasserfall (2/2)
      [-638.2, 22.2, 407.5], // 17
      [-724.2, 31.1, 467.7], // 18
      [-810.2, 40, 528, {width: 13}], // 19 steep climb
      [-845.7, 43, 545.5, {width: 13, kerbL: true}], // 20 Hochsprung (1/2)
      [-884.8, 46, 551.5, {width: 13, kerbL: true}], // 21 Hochsprung (2/2)
      [-934.8, 46.6, 551.5], // 22
      [-1038.1, 47.7, 551.5], // 23
      [-1141.5, 48.9, 551.5], // 24
      [-1244.8, 50, 551.5, {kerbR: true, runoffL: 'gravel', width: 13}], // 25 blind crest
      [-1278.8, 50, 537.4, {width: 13, kerbR: true, kerbL: true, runoffL: 'gravel'}], // 26 Tannen (1/2)
      [-1292.8, 50, 503.5, {width: 13, kerbL: true, runoffL: 'gravel'}], // 27 Tannen (2/2)
      [-1292.8, 50.2, 453.5], // 28
      [-1292.8, 50.3, 403.5], // 29 drs2det
      [-1292.8, 50.5, 333.5], // 30 drs2start
      [-1292.8, 50.9, 216], // 31
      [-1292.8, 51.3, 98.5], // 32
      [-1292.8, 51.6, -19], // 33
      [-1292.8, 52, -136.5, {kerbL: true, width: 13}], // 34
      [-1297.9, 52, -165.6, {width: 13, kerbL: true, kerbR: true}], // 35 Hexenkessel (1/2)
      [-1312.7, 52, -191.2, {width: 13, kerbR: true}], // 36 Hexenkessel (2/2)
      [-1327.5, 52, -216.7, {width: 13, kerbR: true, kerbL: true}], // 37 Hexenkessel (1/2)
      [-1332.6, 52, -245.8, {width: 13, kerbL: true}], // 38 Hexenkessel (2/2)
      [-1332.6, 52, -295.8], // 39
      [-1332.6, 52, -360.8], // 40
      [-1332.6, 52, -425.8, {kerbR: true, runoffL: 'gravel', width: 13}], // 41
      [-1320.3, 52, -455.5, {width: 13, kerbR: true, kerbL: true, runoffL: 'gravel'}], // 42 Bergblick (1/2)
      [-1290.6, 52, -467.8, {width: 13, kerbL: true, runoffL: 'gravel'}], // 43 Bergblick (2/2)
      [-1230.6, 49.1, -467.8], // 44
      [-1147.7, 45, -467.8], // 45
      [-1064.8, 41, -467.8, {width: 13}], // 46 downhill plunge
      [-1039.7, 39.5, -469.6, {width: 13}], // 47 Flugplatz (1/2)
      [-1015.2, 38, -474.8, {width: 13}], // 48 Flugplatz (2/2)
      [-990.6, 36.5, -480, {width: 13}], // 49
      [-965.5, 35, -481.8, {width: 13}], // 50
      [-905.5, 33.1, -481.8], // 51
      [-812.6, 30, -481.8], // 52
      [-719.7, 27, -481.8], // 53
      [-626.8, 24, -481.8, {kerbL: true, width: 13}], // 54
      [-597.2, 22.5, -488.3, {width: 13, kerbL: true, kerbR: true}], // 55 Sturz (1/2)
      [-573.2, 21, -506.8, {width: 13, kerbR: true}], // 56 Sturz (2/2)
      [-541, 19.5, -545.1], // 57
      [-489.6, 17, -606.3, {kerbR: true, width: 13}], // 58
      [-465.6, 15.5, -624.8, {width: 13, kerbR: true, kerbL: true}], // 59 Waldeck (1/2)
      [-436, 14, -631.3, {width: 13, kerbL: true}], // 60 Waldeck (2/2)
      [-386, 12.8, -631.3], // 61
      [-269.3, 9.8, -631.3], // 62
      [-152.7, 6.9, -631.3], // 63
      [-36, 4, -631.3, {kerbR: true, width: 14}], // 64
      [-10.5, 3, -620.8, {width: 14, kerbR: true, kerbL: true}], // 65 Zielkurve (1/2)
      [0, 2, -595.3, {width: 14, kerbL: true}], // 66 Zielkurve (2/2)
      [0, 1.3, -506.9, {width: 14, barrierR: 26}], // 67
      [0, 0.7, -418.4, {width: 14, barrierR: 26}], // 68
      [0, 0, -330, {width: 14, barrierR: 26}], // 69 pit entry
    ],
  ),
  sectorEndCps: [24, 51],
  pitLane: { entryCp: 69, exitCp: 1, side: -1 },
  drsZones: [
    { detectionCp: 65, startCp: 69, endCp: 2 },
    { detectionCp: 29, startCp: 30, endCp: 34 },
  ],
  corners: [
    { cp: 3, name: 'Schlosskurve' },
    { cp: 8, name: 'Bärenkurve' },
    { cp: 15, name: 'Wasserfall' },
    { cp: 20, name: 'Hochsprung' },
    { cp: 26, name: 'Tannen' },
    { cp: 35, name: 'Hexenkessel' },
    { cp: 37, name: 'Hexenkessel' },
    { cp: 42, name: 'Bergblick' },
    { cp: 47, name: 'Flugplatz' },
    { cp: 55, name: 'Sturz' },
    { cp: 59, name: 'Waldeck' },
    { cp: 65, name: 'Zielkurve' },
  ],
  poleSide: -1,
  defaultLaps: 10,
  referenceLapTime: 78,
  environment: {
    theme: 'forest',
    timeOfDay: 14,
    weather: 'dynamic',
    vibe: 'Black Forest afternoon: dense spruce forest hugging the barriers, 50 m of elevation change, mist in the valley, timber marshal huts, a castle on the hill',
  },
  description: 'Fifty metres of climb into the blind Hochsprung crest, a plateau through the forest and a fast plunge back to the valley. Weather can change in a lap.',
};

/**
 * AUTODROMO VELOCITÀ — high-speed temple. Two chicanes, the 190 m Curva Grande, the Lesmos, a 1 km back straight,
 * Curva Alboreto, the Ascari chicane and the Parabolica.
 */
export const VELOCITA: TrackDefinition = {
  id: 'velocita',
  name: 'Autodromo Velocità',
  grandPrixName: 'Velocità Grand Prix',
  country: 'IT',
  location: 'Parco della Velocit\u00e0, Lombardy',
  defaultWidth: 12,
  controlPoints: buildControlPoints(
    [
      [0, 0, 0, {width: 14, barrierR: 26}], // 0 S/F
      [0, 0, 260, {width: 14, barrierR: 26}], // 1 pitExit
      [0, 0, 340, {width: 14, barrierR: 26, kerbR: true, runoffL: 'runoff'}], // 2
      [-4.1, 0, 354, {width: 12, kerbR: true, kerbL: true, runoffL: 'runoff'}], // 3 Variante del Rettifilo (1/2)
      [-15, 0, 363.6, {width: 12, kerbL: true, runoffL: 'runoff', runoffR: 'runoff'}], // 4 Variante del Rettifilo (2/2)
      [-26, 0, 373.2, {width: 12, kerbL: true, kerbR: true, runoffR: 'runoff'}], // 5 Variante del Rettifilo (1/2)
      [-30, 0, 387.1, {width: 12, kerbR: true, runoffR: 'runoff'}], // 6 Variante del Rettifilo (2/2)
      [-30, 0, 437.1], // 7
      [-30, 0, 512.1], // 8
      [-30, 0, 587.1, {kerbR: true, width: 12}], // 9
      [-39.8, 0, 648.9, {width: 12, kerbR: true}], // 10 Curva Grande (1/5)
      [-68.2, 0, 704.7, {width: 12, kerbR: true, kerbL: true}], // 11 Curva Grande (2/5)
      [-112.5, 0, 748.9, {width: 12, kerbR: true, kerbL: true}], // 12 Curva Grande (3/5)
      [-168.2, 0, 777.3, {width: 12, kerbR: true, kerbL: true}], // 13 Curva Grande (4/5)
      [-230, 0, 787.1, {width: 12, kerbL: true}], // 14 Curva Grande (5/5)
      [-290, -0.2, 787.1, {runoffL: 'grass', runoffR: 'grass'}], // 15
      [-430, -0.7, 787.1, {runoffL: 'grass', runoffR: 'grass'}], // 16 drs3det
      [-490, -0.9, 787.1, {runoffL: 'grass', runoffR: 'grass'}], // 17 drs3start
      [-611.6, -1.3, 787.1, {runoffL: 'grass', runoffR: 'grass'}], // 18
      [-733.3, -1.7, 787.1, {runoffL: 'grass', runoffR: 'grass'}], // 19
      [-854.9, -2.2, 787.1, {runoffL: 'grass', runoffR: 'grass'}], // 20
      [-976.5, -2.6, 787.1, {runoffL: 'grass', runoffR: 'grass'}], // 21
      [-1098.1, -3, 787.1, {runoffL: 'grass', runoffR: 'runoff', kerbL: true, width: 12}], // 22
      [-1111, -3, 790.3, {width: 12, kerbL: true, kerbR: true, runoffR: 'runoff'}], // 23 Variante della Roggia (1/2)
      [-1121, -3, 799.1, {width: 12, kerbR: true, runoffR: 'runoff', runoffL: 'runoff'}], // 24 Variante della Roggia (2/2)
      [-1131, -3, 807.8, {width: 12, kerbR: true, kerbL: true, runoffL: 'runoff'}], // 25 Variante della Roggia (1/2)
      [-1144, -3, 811, {width: 12, kerbL: true, runoffL: 'runoff'}], // 26 Variante della Roggia (2/2)
      [-1194, -3, 811], // 27
      [-1299, -3, 811], // 28
      [-1404, -3, 811, {kerbR: true, width: 12}], // 29
      [-1437.8, -3, 803.5, {width: 12, kerbR: true, kerbL: true}], // 30 Lesmo 1 (1/2)
      [-1465.2, -3, 782.4, {width: 12, kerbL: true}], // 31 Lesmo 1 (2/2)
      [-1491, -3, 751.8], // 32
      [-1542.4, -3, 690.5, {kerbR: true, width: 12}], // 33
      [-1552.8, -3, 672.5, {width: 12, kerbR: true, kerbL: true}], // 34 Lesmo 2 (1/2)
      [-1556.4, -3, 651.9, {width: 12, kerbL: true}], // 35 Lesmo 2 (2/2)
      [-1556.4, -2.8, 601.9, {runoffL: 'grass', runoffR: 'grass'}], // 36
      [-1556.4, -2.3, 501.9, {runoffL: 'grass', runoffR: 'grass'}], // 37 drs2det
      [-1556.4, -2, 431.9, {runoffL: 'grass', runoffR: 'grass'}], // 38 drs2start
      [-1556.4, -1.3, 293.6, {runoffL: 'grass', runoffR: 'grass'}], // 39
      [-1556.4, -0.6, 155.3, {runoffL: 'grass', runoffR: 'grass'}], // 40
      [-1556.4, 0, 16.9, {runoffL: 'grass', runoffR: 'grass'}], // 41
      [-1556.4, 0.7, -121.4, {runoffL: 'grass', runoffR: 'grass'}], // 42
      [-1556.4, 1.3, -259.7, {runoffL: 'grass', runoffR: 'grass'}], // 43
      [-1556.4, 2, -398.1, {runoffL: 'grass', runoffR: 'grass', kerbR: true, width: 13}], // 44 Serraglio straight
      [-1539, 2, -463.1, {width: 13, kerbR: true}], // 45 Curva Alboreto (1/3)
      [-1491.4, 2, -510.6, {width: 13, kerbR: true, kerbL: true}], // 46 Curva Alboreto (2/3)
      [-1426.4, 2, -528.1, {width: 13, kerbL: true}], // 47 Curva Alboreto (3/3)
      [-1366.4, 1.9, -528.1, {runoffL: 'grass', runoffR: 'grass'}], // 48
      [-1226.4, 1.6, -528.1, {runoffL: 'grass', runoffR: 'grass'}], // 49
      [-1086.4, 1.2, -528.1, {runoffL: 'grass', runoffR: 'grass'}], // 50
      [-946.4, 0.9, -528.1, {runoffL: 'grass', runoffR: 'grass'}], // 51
      [-806.4, 0.6, -528.1, {runoffL: 'grass', runoffR: 'grass'}], // 52
      [-666.4, 0.3, -528.1, {runoffL: 'grass', runoffR: 'grass'}], // 53
      [-526.4, 0, -528.1, {runoffL: 'grass', runoffR: 'grass', kerbL: true, width: 12}], // 54
      [-500.8, 0, -532.6, {width: 12, kerbL: true, kerbR: true}], // 55 Ascari (1/2)
      [-478.2, 0, -545.6, {width: 12, kerbR: true}], // 56 Ascari (2/2)
      [-455.7, 0, -558.6, {width: 12, kerbR: true, kerbL: true}], // 57 Ascari (1/2)
      [-430, 0, -563.2, {width: 12, kerbL: true}], // 58 Ascari (2/2)
      [-380, 0, -563.2], // 59
      [-290, 0, -563.2], // 60
      [-200, 0, -563.2], // 61
      [-110, 0, -563.2, {kerbR: true, width: 14}], // 62
      [-55, 0, -548.4, {width: 14, kerbR: true}], // 63 Parabolica (1/3)
      [-14.7, 0, -508.2, {width: 14, kerbR: true, kerbL: true}], // 64 Parabolica (2/3)
      [0, 0, -453.2, {width: 14, kerbL: true}], // 65 Parabolica (3/3)
      [0, 0, -330, {width: 14, barrierR: 26}], // 66 pit entry
    ],
  ),
  sectorEndCps: [26, 48],
  pitLane: { entryCp: 66, exitCp: 1, side: -1 },
  drsZones: [
    { detectionCp: 64, startCp: 66, endCp: 2 },
    { detectionCp: 37, startCp: 38, endCp: 44 },
    { detectionCp: 16, startCp: 17, endCp: 22 },
  ],
  corners: [
    { cp: 3, name: 'Variante del Rettifilo' },
    { cp: 5, name: 'Variante del Rettifilo' },
    { cp: 12, name: 'Curva Grande' },
    { cp: 23, name: 'Variante della Roggia' },
    { cp: 25, name: 'Variante della Roggia' },
    { cp: 30, name: 'Lesmo 1' },
    { cp: 34, name: 'Lesmo 2' },
    { cp: 46, name: 'Curva Alboreto' },
    { cp: 55, name: 'Ascari' },
    { cp: 57, name: 'Ascari' },
    { cp: 64, name: 'Parabolica' },
  ],
  poleSide: -1,
  defaultLaps: 10,
  referenceLapTime: 83,
  environment: {
    theme: 'permanent',
    timeOfDay: 12.5,
    weather: 'dry',
    vibe: 'The temple of speed at midday: royal park with tall poplars, old banking ruins in the trees, tifosi red in every grandstand, hard white light',
  },
  description: 'The temple of speed. Three flat-out straights, two chicanes and the long parabolic sweep onto the pit straight. Lowest downforce on the calendar.',
};

export const CIRCUITS: TrackDefinition[] = [PORTO_AZZURRO, AL_SAHRA, RIVIERA, SCHWARZWALD, VELOCITA];
