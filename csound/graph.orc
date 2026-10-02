sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1

gaDrum init 0
gaMus init 0
gaDly init 0
gaRev init 0
gkHit init 0

giTri ftgen 1, 0, 4096, 7, 0, 1024, 1, 2048, -1, 1024, 0
giIrL ftgen 20, 0, 262144, 2, 0
giIrR ftgen 21, 0, 262144, 2, 0
giIrLen init 153600

instr 1
  kPlay chnget "playing"
  kBpm chnget "bpm"
  if kBpm < 40 then
    kBpm = 122
  endif
  kStep init 0
  kSamp init 999999
  if kPlay < 1 goto hold
  kSix = sr * 60 / kBpm / 4
  kSamp = kSamp + ksmps
  if kSamp < kSix goto hold
  kSamp = 0
  kBit = 2 ^ kStep
  kBreak chnget "break"
  kSwing chnget "swing"
  kOdd = kStep % 2
  kDelay = 0
  if kOdd > 0 then
    kDelay = (60 / kBpm / 4) * kSwing
  endif
  kLen0 chnget "len0"
  kLen1 chnget "len1"
  kLen2 chnget "len2"
  kLen3 chnget "len3"
  kLen4 chnget "len4"
  kLen5 chnget "len5"
  kDecay chnget "decay"
  kRing chnget "ring"
  kM0 chnget "mask0"
  kM1 chnget "mask1"
  kM2 chnget "mask2"
  kM3 chnget "mask3"
  kM4 chnget "mask4"
  kM5 chnget "mask5"
  kM6 chnget "mask6"
  kM7 chnget "mask7"
  kU0 chnget "mute0"
  kU1 chnget "mute1"
  kU2 chnget "mute2"
  kU3 chnget "mute3"
  kU4 chnget "mute4"
  kU5 chnget "mute5"
  kU6 chnget "mute6"
  kU7 chnget "mute7"
  kL0 chnget "lvl0"
  kL1 chnget "lvl1"
  kL2 chnget "lvl2"
  kL3 chnget "lvl3"
  kL4 chnget "lvl4"
  kL5 chnget "lvl5"
  kL6 chnget "lvl6"
  kL7 chnget "lvl7"
  kRoot chnget "root"
  kCut chnget "cutoff"
  kReso chnget "reso"
  kn0 chnget "n0"
  kn1 chnget "n1"
  kn2 chnget "n2"
  kn3 chnget "n3"
  kH0 = int(kM0 / kBit) % 2
  kH1 = int(kM1 / kBit) % 2
  kH2 = int(kM2 / kBit) % 2
  kH3 = int(kM3 / kBit) % 2
  kH4 = int(kM4 / kBit) % 2
  kH5 = int(kM5 / kBit) % 2
  kH6 = int(kM6 / kBit) % 2
  kH7 = int(kM7 / kBit) % 2
  if kH0 != 0 && kU0 < 1 && kBreak < 1 then
    event "i", 2, 0, kLen0, kL0
  endif
  kHatP = 0.92
  kOpenP = 1
  if kBreak > 0 then
    kHatP = 0.45
    kOpenP = 0.4
  endif
  kRh rnd 1
  kRo rnd 1
  if kH1 != 0 && kU1 < 1 && kRh < kHatP then
    event "i", 3, kDelay, kLen1 + 0.05, kL1, 0
  endif
  if kH2 != 0 && kU2 < 1 && kRo < kOpenP then
    event "i", 3, kDelay, kLen2 + 0.05, kL2, 1
  endif
  if kH3 != 0 && kU3 < 1 && kBreak < 1 then
    event "i", 5, 0, kLen3 + 0.05, kL3
  endif
  if kH4 != 0 && kU4 < 1 && kBreak < 1 then
    event "i", 6, 0, kLen4 + 0.04, kL4
  endif
  if kH5 != 0 && kU5 < 1 && kBreak < 1 then
    event "i", 7, 0, kLen5 * 1.15 + 0.16, kL5, kRoot, kStep
  endif
  if kH6 != 0 && kU6 < 1 then
    event "i", 8, 0, kDecay + 0.1, kL6, kCut, kReso, kn0, kn1, kn2, kn3, kDecay
  endif
  if kH7 != 0 && kU7 < 1 && kL7 > 0.001 then
    kTen chnget "tension"
    kOrd chnget "order"
    event "i", 9, 0, kRing + 0.08, kL7, kRoot, kTen, kOrd, kRing
  endif
  chnset kStep, "step"
  kStep = (kStep + 1) % 16
  if kStep == 0 then
    chnset 1, "bar"
  endif
hold:
endin

instr 2
  gkHit = 1
  idrop = 0.07
  if p3 * 0.4 < idrop then
    idrop = p3 * 0.4
  endif
  if idrop < 0.005 then
    idrop = 0.005
  endif
  afr expon 165, idrop, 46
  aphs phasor afr
  abody = sin(aphs * 6.283185307179586)
  ipeak = 0.95 * p4
  if ipeak < 0.0001 then
    ipeak = 0.0001
  endif
  irel = p3 - 0.004
  if irel < 0.005 then
    irel = 0.005
  endif
  aenv expseg 0.0001, 0.004, ipeak, irel, 0.0001
  aclick rand 1
  aclick biquad aclick, 0.845244, -1.690488, 0.845244, 1, -1.666804, 0.714168
  iclick = 0.28 * p4
  if iclick < 0.0001 then
    iclick = 0.0001
  endif
  agate expseg 0.0001, 0.002, iclick, 0.018, 0.0001
  gaDrum = gaDrum + abody * aenv + aclick * agate
endin

instr 3
  iopen = p5
  ifrq = 8000
  ipeak = 0.07 * p4
  if iopen > 0.5 then
    ifrq = 5200
    ipeak = 0.16 * p4
  endif
  if ipeak < 0.0001 then
    ipeak = 0.0001
  endif
  anoise rand 1
  anoise butterhp anoise, ifrq
  aenv expseg 0.0001, 0.002, ipeak, p3, 0.0001
  gaDrum = gaDrum + anoise * aenv
  if iopen > 0.5 then
    abright rand 1
    abright butterbp abright, 9000, 4000
    abright = abright * 0.05 * p4
    agate expseg 0.0001, 0.002, 1, p3 * 0.7, 0.0001
    gaDrum = gaDrum + abright * agate
  endif
endin

instr 5
  ipeak = 0.28 * p4
  if ipeak < 0.0001 then
    ipeak = 0.0001
  endif
  idrop = 0.12
  if p3 < idrop then
    idrop = p3
  endif
  if idrop < 0.01 then
    idrop = 0.01
  endif
  kfr expon 196, idrop, 150
  abody oscili 1, kfr, giTri
  aenv expseg 0.0001, 0.002, ipeak, 0.01, ipeak, p3, 0.0001
  gaDrum = gaDrum + abody * aenv
  anoise rand 1
  anoise butterbp anoise, 1800, 2250
  a1 expseg 0.0001, 0.002, 0.22 * p4, p3 * 0.7, 0.0001
  a2 linseg 0, 0.012, 0.0001, 0.002, 0.18 * p4, p3 * 0.55, 0.0001
  a3 linseg 0, 0.024, 0.0001, 0.002, 0.14 * p4, p3 * 0.4, 0.0001
  gaDrum = gaDrum + anoise * (a1 + a2 + a3)
  ahp rand 1
  ahp butterhp ahp, 2500
  ahp = ahp * 0.16 * p4
  asend expseg 0.0001, 0.002, 1, p3 * 0.8, 0.0001
  gaDly = gaDly + ahp * asend
endin

instr 6
  a1 oscili 1, 380, giTri
  a2 oscili 1, 640, giTri
  ipeak = 0.18 * p4
  ipeak2 = 0.1 * p4
  if ipeak < 0.0001 then
    ipeak = 0.0001
  endif
  if ipeak2 < 0.0001 then
    ipeak2 = 0.0001
  endif
  aenv expseg 0.0001, 0.001, ipeak, p3, 0.0001
  aenv2 expseg 0.0001, 0.001, ipeak2, p3, 0.0001
  anoise rand 1
  anoise butterbp anoise, 1800, 1500
  anoise = anoise * 0.08 * p4
  agate expseg 0.0001, 0.002, 1, 0.04, 0.0001
  gaDrum = gaDrum + a1 * aenv + a2 * aenv2 + anoise * agate
endin

instr 7
  inote = p5 - 24
  if p6 == 8 goto fifth
  if p6 == 10 goto fifth
  imod = p6 % 7
  if imod == 6 && (rnd(1) < 0.5) goto fifth
  goto pitched
fifth:
  inote = inote + 7
pitched:
  ifrq = cpsmidinn(inote)
  abody oscili 1, ifrq
  abody butterlp abody, 220
  asub oscili 1, ifrq * 0.5
  aenv expseg 0.0001, 0.012, 0.55 * p4, 0.05, 0.55 * p4, p3, 0.0001
  aenv2 expseg 0.0001, 0.02, 0.45 * p4, 0.08, 0.45 * p4, p3, 0.0001
  gaMus = gaMus + abody * aenv + asub * aenv2
endin

instr 8
  icut = p5
  if icut < 80 then
    icut = 680
  endif
  ires = p6
  idec = p11
  if idec < 0.02 then
    idec = p3
  endif
  istart = icut * (2.4 + ires / 10)
  if istart > 4200 then
    istart = 4200
  endif
  iend1 = icut * 0.55
  if iend1 < 80 then
    iend1 = 80
  endif
  iend2 = icut * 0.45
  if iend2 < 90 then
    iend2 = 90
  endif
  istart2 = istart * 0.85
  iq = 0.4 + ires / 10
  kcf1 expon istart, idec, iend1
  kcf2 expon istart2, idec, iend2
  ipeak = 0.11 * p4
  if ipeak < 0.0001 then
    ipeak = 0.0001
  endif
  aenv expseg 0.0001, 0.008, ipeak, 0.02, ipeak, idec, 0.0001
  a1 vco2 1, cpsmidinn(p7) * cent(-9)
  a2 vco2 1, cpsmidinn(p7) * cent(-2)
  a3 vco2 1, cpsmidinn(p7) * cent(4)
  a4 vco2 1, cpsmidinn(p8) * cent(-7)
  a5 vco2 1, cpsmidinn(p8)
  a6 vco2 1, cpsmidinn(p8) * cent(6)
  a7 vco2 1, cpsmidinn(p9) * cent(-5)
  a8 vco2 1, cpsmidinn(p9) * cent(2)
  a9 vco2 1, cpsmidinn(p9) * cent(8)
  a10 vco2 1, cpsmidinn(p10) * cent(-3)
  a11 vco2 1, cpsmidinn(p10) * cent(4)
  a12 vco2 1, cpsmidinn(p10) * cent(10)
  amix = a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11 + a12
  amix lowpass2 amix, kcf1, iq
  amix lowpass2 amix, kcf2, 0.6
  asig = amix * aenv
  gaMus = gaMus + asig
  gaDly = gaDly + asig
  gaRev = gaRev + asig
  aburst rand 1
  aburst butterbp aburst, 900, 1125
  aburst = aburst * 0.05
  agate expseg 0.0001, 0.002, 1, 0.06, 0.0001
  gaDly = gaDly + aburst * agate
endin

instr 9
  if0 = cpsmidinn(p5 + 12) * p6
  iamp = 0.07 * p4
  iord = p7
  iring = p8
  ifund = 2.236068
  a1 oscili 1, if0
  ag1 expseg 0.0001, 0.002, iamp, iring, 0.0001
  asig = a1 * ag1
  if iord < 2 goto platedone
  a2 oscili 1, if0
  ag2 expseg 0.0001, 0.002, iamp / 1.45, iring, 0.0001
  asig = asig + a2 * ag2
  if iord < 3 goto platedone
  a3 oscili 1, if0 * 1.264911
  ag3 expseg 0.0001, 0.002, iamp / 1.9, iring / 1.264911, 0.0001
  asig = asig + a3 * ag3
  if iord < 4 goto platedone
  a4 oscili 1, if0 * 1.414214
  ag4 expseg 0.0001, 0.002, iamp / 2.35, iring / 1.414214, 0.0001
  asig = asig + a4 * ag4
  if iord < 5 goto platedone
  a5 oscili 1, if0 * 1.414214
  ag5 expseg 0.0001, 0.002, iamp / 2.8, iring / 1.414214, 0.0001
  asig = asig + a5 * ag5
  if iord < 6 goto platedone
  a6 oscili 1, if0 * 1.612452
  ag6 expseg 0.0001, 0.002, iamp / 3.25, iring / 1.612452, 0.0001
  asig = asig + a6 * ag6
platedone:
  ibp = if0 * 3
  if ibp > 8000 then
    ibp = 8000
  endif
  anoise rand 1
  anoise butterbp anoise, ibp, ibp / 1.4
  anoise = anoise * iamp * 2.2
  agate expseg 0.0001, 0.002, 1, 0.025, 0.0001
  asig = asig + anoise * agate
  gaMus = gaMus + asig
  gaRev = gaRev + asig
  gaDly = gaDly + asig * 0.35
endin

instr 99
  kBpm chnget "bpm"
  if kBpm < 40 then
    kBpm = 122
  endif
  kDiv chnget "div"
  if kDiv < 0.1 then
    kDiv = 0.75
  endif
  kFb chnget "feedback"
  kFb limit kFb, 0, 0.88
  kDamp chnget "damp"
  kDamp limit kDamp, 200, 8000
  kSend chnget "send"
  kRev chnget "reverb"
  kDrive chnget "drive"
  kAmt = 1 + kDrive * 10
  kSrs chnget "srs"
  kSide = kSrs * 2.2
  kMs = 1000 * 60 / kBpm * kDiv
  kMs limit kMs, 20, 1800
  if gkHit > 0.5 then
    gkHit = 0
    reinit DUCK
  endif
DUCK:
  kDuck linseg 1, 0.03, 0.62, 0.19, 1
  rireturn
  aFbL init 0
  aFbR init 0
  aIn = gaDly * kSend
  aDelL vdelay3 aIn + aFbL, kMs, 2000
  aDelR vdelay3 aFbR, kMs, 2000
  aDampL butterlp aDelL, kDamp
  aDampR butterlp aDelR, kDamp
  aFbR = aDampL * kFb
  aFbL = aDampR * kFb
  aDelayL = (aDelL * 0.981 + aDelR * 0.195) * 0.85
  aDelayR = (aDelL * 0.195 + aDelR * 0.981) * 0.85
  aWet = gaRev * kRev * 0.7
  aWet butterlp aWet, 2800
  aRevL ftconv aWet, giIrL, 2048, 0, giIrLen
  aRevR ftconv aWet, giIrR, 2048, 0, giIrLen
  aRevL = aRevL * 0.9
  aRevR = aRevR * 0.9
  kLift = 1.4
  aBusL = (gaDrum * 0.9 + (gaMus + aDelayL + aRevL) * kDuck) * kLift
  aBusR = (gaDrum * 0.9 + (gaMus + aDelayR + aRevR) * kDuck) * kLift
  kNorm = tanh(kAmt)
  aBusL = tanh(aBusL * kAmt) / kNorm
  aBusR = tanh(aBusR * kAmt) / kNorm
  aBusL compress2 aBusL, aBusL, -90, -19, -1, 3.2, 0.012, 0.28, 0.01
  aBusR compress2 aBusR, aBusR, -90, -19, -1, 3.2, 0.012, 0.28, 0.01
  aMid = (aBusL + aBusR) * 0.5
  aSide = (aBusL - aBusR) * 0.5
  aSide butterhp aSide, 220
  aSide biquad aSide, 1.384, -1.815, 0.684, 1, -1.173, 0.427
  aSide = aSide * kSide
  out (aMid + aSide) * 0.85, (aMid - aSide) * 0.85
  clear gaDrum, gaMus, gaDly, gaRev
endin
