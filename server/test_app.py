"""Regression tests for the lightweight Cover Forge API boundary."""

import base64
import io
import unittest

from PIL import Image

from app import app


def _png_base64(width=300, height=300):
    image = Image.new("RGB", (width, height), "navy")
    output = io.BytesIO()
    image.save(output, "PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


class CoverForgeApiTest(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()

    def test_health(self):
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_export_pdf_requires_an_image(self):
        response = self.client.post("/api/export-pdf", json={})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "png_base64 required")

    def test_export_pdf_rejects_invalid_bleed(self):
        payload = {
            "png_base64": _png_base64(),
            "width_in": 1,
            "height_in": 1,
        }

        for bleed in ("bad", -0.125, 0.5, float("inf")):
            with self.subTest(bleed=bleed):
                response = self.client.post(
                    "/api/export-pdf", json={**payload, "bleed_in": bleed}
                )
                self.assertEqual(response.status_code, 400)

    def test_export_pdf_returns_an_exact_size_pdf(self):
        response = self.client.post(
            "/api/export-pdf",
            json={
                "png_base64": _png_base64(),
                "width_in": 1,
                "height_in": 1,
                "bleed_in": 0.125,
                "cmyk": False,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/pdf")
        self.assertTrue(response.data.startswith(b"%PDF-"))
        self.assertEqual(response.headers["X-Dim-Match"], "ok")
        self.assertEqual(response.headers["X-CMYK-Mode"], "none")


if __name__ == "__main__":
    unittest.main()
