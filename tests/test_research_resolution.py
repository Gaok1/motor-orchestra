"""Controles independentes dos limites e da separação temporal/eventos."""
import itertools
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from research_resolution_metrics import evaluate,oracle_coverage,oracle_event_f1,temporal


class OracleTests(unittest.TestCase):
    def test_frame_availability_is_not_a_feasible_event_sequence(self):
        ref=[[0,1,60,1]];notes=[[0,.6,60,1],[.4,1,60,1]]
        self.assertEqual(temporal([],ref,1,notes)['temporalOracleCoverage'],1)
        out=oracle_coverage(notes,ref)
        self.assertAlmostEqual(temporal(out,ref,1)['melodyCoverage'],.6)

    def test_coverage_oracle_agrees_with_exhaustive_search(self):
        ref=[[0,1,60,1],[1,2,62,1]]
        notes=[[0,1.4,60,1],[0,.8,60,1],[.8,1,60,1],[1,2,62,1],[0,2,70,1]]
        best=0
        for bits in itertools.product([0,1],repeat=len(notes)):
            seq=sorted([n for n,b in zip(notes,bits) if b])
            if any(a[1]>b[0] for a,b in zip(seq,seq[1:])):continue
            best=max(best,temporal(seq,ref,2)['correctNoteSeconds'])
        out=oracle_coverage(notes,ref)
        self.assertAlmostEqual(temporal(out,ref,2)['correctNoteSeconds'],best)
        self.assertTrue(all(n in notes for n in out))

    def test_event_oracle_respects_overlap_and_one_to_one_matching(self):
        ref=[[0,.1,60,1],[.08,.18,60,1]]
        out,status=oracle_event_f1(ref,ref)
        self.assertTrue(status['optimal']);self.assertEqual(len(out),1)
        self.assertAlmostEqual(evaluate(out,ref,.18)['noteF1'],2/3)

    def test_recall_does_not_hide_silence_or_false_positives(self):
        result=evaluate([[0,3,60,1]],[[1,2,60,1]],3)
        self.assertEqual(result['melodyCoverage'],1)
        self.assertAlmostEqual(result['temporalPrecision'],1/3)
        self.assertEqual(result['playedDuringSilenceSeconds'],2)
        self.assertEqual(result['onsetPitchF1'],0)

    def test_decomposition_accounts_for_all_reference_note_time(self):
        r=temporal([[0,.5,60,1]],[[0,1,60,1],[1,2,62,1]],2,[[0,1,60,1]])
        self.assertEqual(r['absentNoteSeconds'],1)
        self.assertEqual(r['availableButUnselectedNoteSeconds'],.5)
        self.assertEqual(r['selectedCorrectAvailableSeconds'],.5)

    def test_oracle_uses_the_same_boundary_rounding_as_event_metrics(self):
        reference=[[0,.4,60,1]];candidates=[[.05004,.4,60,1]]
        out,status=oracle_event_f1(candidates,reference)
        self.assertTrue(status['optimal'])
        self.assertEqual(evaluate(out,reference,.4)['noteF1'],1)


if __name__=='__main__':unittest.main()
