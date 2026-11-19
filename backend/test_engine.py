import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import market_data
import brokers
import db


class TestGammaDeskPythonEngine(unittest.TestCase):
    def test_black_scholes_call_put_parity_and_bounds(self):
        ce = market_data.black_scholes(25000.0, 25000.0, 7.0 / 365.0, 0.065, 0.14, "CE")
        pe = market_data.black_scholes(25000.0, 25000.0, 7.0 / 365.0, 0.065, 0.14, "PE")
        self.assertGreater(ce["price"], 50.0)
        self.assertGreater(pe["price"], 50.0)
        self.assertGreater(ce["delta"], 0.45)
        self.assertLess(pe["delta"], -0.40)

    def test_statutory_charges_calculation(self):
        chg = market_data.calculate_charges(200.0, 250.0, 75, brokerage_per_order=20.0)
        self.assertEqual(chg["brokerage"], 40.0)
        self.assertGreater(chg["stt"], 0.0)
        self.assertGreater(chg["gst"], 0.0)
        self.assertGreater(chg["total"], 40.0)

    def test_rfc6238_totp_length_and_digits(self):
        code = brokers.generate_totp("JBSWY3DPEHPK3PXP")
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())

    def test_user_auth_and_password_hashing(self):
        with tempfile.TemporaryDirectory() as tmp:
            db.DB_PATH = os.path.join(tmp, "test.db")
            db.init_db()
            created = db.create_user("trader@gammadesk.in", "Arjun Mehta", "Secret123!")
            self.assertEqual(created["user"]["email"], "trader@gammadesk.in")
            self.assertEqual(created["user"]["paper_capital"], 1000000.0)

            logged = db.authenticate_user("trader@gammadesk.in", "Secret123!")
            self.assertEqual(logged["user"]["id"], created["user"]["id"])
            fetched = db.get_user_by_token(logged["token"])
            self.assertIsNotNone(fetched)
            self.assertEqual(fetched["full_name"], "Arjun Mehta")

            with self.assertRaises(ValueError):
                db.authenticate_user("trader@gammadesk.in", "WrongPassword")


if __name__ == "__main__":
    unittest.main()
