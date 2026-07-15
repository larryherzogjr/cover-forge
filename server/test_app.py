"""Regression tests for the lightweight Cover Forge API boundary."""

import base64
import io
import re
import unittest

from PIL import Image

from app import WEB_DIR, _as_bool, _resolve_web_dir, app


def _png_base64(width=300, height=300, mode="RGB"):
    color = (0, 0, 128, 255) if mode == "RGBA" else "navy"
    image = Image.new(mode, (width, height), color)
    output = io.BytesIO()
    image.save(output, "PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


def _pdf_box(data, name):
    match = re.search(rb"/" + name.encode("ascii") + rb"\s*\[\s*([^]]+)\]", data)
    if not match:
        raise AssertionError("PDF has no {}".format(name))
    return [float(value) for value in match.group(1).split()]


class CoverForgeApiTest(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()

    def test_health(self):
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_static_frontend_is_served_from_the_expected_directory(self):
        self.assertTrue(WEB_DIR.endswith("/web"))
        for path, status in (("/", 200), ("/src/ui.js", 200), ("/api/missing", 404)):
            response = self.client.get(path)
            try:
                self.assertEqual(response.status_code, status)
            finally:
                response.close()

    def test_empty_web_dir_setting_disables_static_serving(self):
        self.assertIsNone(_resolve_web_dir(""))
        self.assertIsNone(_resolve_web_dir("   "))

    def test_export_pdf_requires_an_image(self):
        response = self.client.post("/api/export-pdf", json={})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "image file or png_base64 required")

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
        self.assertEqual(_pdf_box(response.data, "MediaBox"), [0, 0, 72, 72])
        self.assertEqual(_pdf_box(response.data, "TrimBox"), [9, 9, 63, 63])

    def test_export_pdf_uses_the_requested_binding_specific_trim_inset(self):
        response = self.client.post(
            "/api/export-pdf",
            json={
                "png_base64": _png_base64(600, 600),
                "width_in": 2,
                "height_in": 2,
                "bleed_in": 0.51,
                "cmyk": False,
            },
        )

        self.assertEqual(response.status_code, 200)
        trim = _pdf_box(response.data, "TrimBox")
        for actual, expected in zip(trim, [36.72, 36.72, 107.28, 107.28]):
            self.assertAlmostEqual(actual, expected, places=4)

    def test_export_pdf_accepts_multipart_without_base64_overhead(self):
        png = base64.b64decode(_png_base64())
        response = self.client.post(
            "/api/export-pdf",
            data={
                "image": (io.BytesIO(png), "cover.png"),
                "width_in": "1",
                "height_in": "1",
                "trim_inset_in": "0.125",
                "cmyk": "false",
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Dim-Match"], "ok")
        self.assertEqual(_pdf_box(response.data, "TrimBox"), [9, 9, 63, 63])

    def test_export_pdf_strips_an_unused_canvas_alpha_channel(self):
        response = self.client.post(
            "/api/export-pdf",
            json={
                "png_base64": _png_base64(mode="RGBA"),
                "width_in": 1,
                "height_in": 1,
                "bleed_in": 0.125,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn(b"/SMask", response.data)

    def test_oversized_uploads_return_json(self):
        previous = app.config["MAX_CONTENT_LENGTH"]
        app.config["MAX_CONTENT_LENGTH"] = 64
        try:
            response = self.client.post(
                "/api/export-pdf",
                data={"image": (io.BytesIO(b"x" * 256), "large.png")},
                content_type="multipart/form-data",
            )
        finally:
            app.config["MAX_CONTENT_LENGTH"] = previous

        self.assertEqual(response.status_code, 413)
        self.assertIn("upload exceeds", response.get_json()["error"])

    def test_form_boolean_parser_does_not_treat_false_as_true(self):
        self.assertFalse(_as_bool("false"))
        self.assertFalse(_as_bool("0"))
        self.assertTrue(_as_bool("true"))
        self.assertTrue(_as_bool("1"))


if __name__ == "__main__":
    unittest.main()
