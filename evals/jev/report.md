# Jev stress report

Model jev-1.14.0, measured 2026-11-07, split held, 391 docs.

Metrics only; this file never holds corpus text.

| key | cases | pos | neg | settled | wrong | recall | fp | trusted | reason |
|---|---|---|---|---|---|---|---|---|---|
| K10_store_opening | 74 | 8 | 66 | 71 | 1 | 1 | 0.02 | yes |  |
| K1_unmeasured | 611 | 36 | 575 | 535 | 113 | 0.47 | 0.17 | no | wrong 0.21 > 0.05; recall 0.47 < 0.67; fp 0.17 > 0.05 |
| K3_proof | 548 | 11 | 537 | 544 | 21 | 1 | 0.04 | yes |  |
| K4_superlative | 611 | 17 | 594 | 603 | 14 | 0.35 | 0.01 | no | recall 0.35 < 0.67 |
| K5_urgency | 548 | 9 | 539 | 535 | 6 | 0.89 | 0.01 | yes |  |
| K7_generic | 541 | 2 | 539 | 350 | 100 | 1 | 0.19 | no | pos 2 < 8; wrong 0.29 > 0.05; fp 0.19 > 0.05 |
| K8_error | 22 | 11 | 11 | 22 | 0 | 1 | 0 | yes |  |
| K9_asks | 18 | 10 | 8 | 17 | 2 | 1 | 0.25 | no | cases 18 < 20; wrong 0.12 > 0.05; fp 0.25 > 0.05 |
| S23_names | 299 | 10 | 289 | 297 | 10 | 0 | 0 | no | recall 0 < 0.67 |
| S24_meaning | 693 | 9 | 684 | 593 | 11 | 0.33 | 0.01 | no | recall 0.33 < 0.67 |
| S25_both_sides | 532 | 10 | 522 | 525 | 2 | 1 | 0 | yes |  |
| S26_buried | 163 | 0 | 163 | 117 | 20 | - | 0.12 | no | pos 0 < 8; wrong 0.17 > 0.05; fp 0.12 > 0.05 |
| S27_reversal | 1004 | 11 | 993 | 987 | 18 | 0.64 | 0.01 | no | recall 0.64 < 0.67 |
| S28_orbit | 242 | 2 | 240 | 216 | 3 | 0 | 0.01 | no | pos 2 < 8; recall 0 < 0.67 |
| S30_echo | 316 | 13 | 303 | 215 | 21 | 0.46 | 0.06 | no | wrong 0.1 > 0.05; recall 0.46 < 0.67; fp 0.06 > 0.05 |
| S31_known | 984 | 11 | 973 | 974 | 7 | 0.45 | 0 | no | recall 0.45 < 0.67 |
| S31_restate | 984 | 2 | 982 | 847 | 55 | 0.5 | 0.05 | no | pos 2 < 8; wrong 0.06 > 0.05; recall 0.5 < 0.67; fp 0.05 > 0.05 |
| S32_kicker | 418 | 0 | 418 | 351 | 3 | - | 0.01 | no | pos 0 < 8 |
| S8_withheld | 20 | 11 | 9 | 20 | 3 | 0.73 | 0 | no | wrong 0.15 > 0.05 |
| X2_change | 375 | 8 | 367 | 346 | 38 | 0.63 | 0.1 | no | wrong 0.11 > 0.05; recall 0.63 < 0.67; fp 0.1 > 0.05 |
| guard.dropped | 63 | 2 | 61 | 54 | 4 | 0 | 0.03 | no | pos 2 < 8; wrong 0.07 > 0.05; recall 0 < 0.67 |
| guard.supports | 55 | 1 | 54 | 47 | 0 | 1 | 0 | no | pos 1 < 8 |
| leave.H3 | 2 | 0 | 2 | 2 | 0 | - | 0 | no | cases 2 < 20; pos 0 < 8; neg 2 < 8 |
| leave.S15 | 170 | 138 | 32 | 107 | 18 | 0.61 | 0.19 | no | wrong 0.17 > 0.05; recall 0.61 < 0.67; fp 0.19 > 0.05 |
| leave.S9 | 3 | 0 | 3 | 3 | 0 | - | 0 | no | cases 3 < 20; pos 0 < 8; neg 3 < 8 |
| leave.W1 | 5 | 1 | 4 | 4 | 0 | 0 | 0 | no | cases 5 < 20; pos 1 < 8; neg 4 < 8; recall 0 < 0.67 |
| leave.W2 | 17 | 7 | 10 | 10 | 3 | 0.29 | 0 | no | cases 17 < 20; pos 7 < 8; wrong 0.3 > 0.05; settled 0.59 < 0.6; recall 0.29 < 0.67 |
| leave.W5 | 16 | 4 | 12 | 12 | 2 | 0 | 0 | no | cases 16 < 20; pos 4 < 8; wrong 0.17 > 0.05; recall 0 < 0.67 |
| register | 377 | 377 | 0 | 366 | 16 | 0.93 | - | yes |  |

## Baselines

Tells per 1,000 words per doc, median and p90, with the doc count.

| register | human Jev | ai Jev | human regex | ai regex |
|---|---|---|---|---|
| essay | 0 / 0 (13) | 0 / 0 (17) | 6.41 / 15.45 (13) | 8.42 / 43.56 (17) |
| docs | 0 / 0 (18) | 0 / 0 (13) | 2.03 / 18.07 (18) | 0 / 13.11 (13) |
| landing | 1.02 / 3.8 (15) | 0 / 5.59 (19) | 14.13 / 35.51 (15) | 15.67 / 41.51 (19) |
| store | 0 / 2.51 (9) | 0 / 3.69 (17) | 5.41 / 37.83 (9) | 15.63 / 24 (17) |
| release | 0 / 0 (16) | 0 / 0 (16) | 12.24 / 48.78 (16) | 0 / 18.52 (16) |

## Spend

$0.0000, 0 requests, 0 input tokens, 27652 cache hits.
