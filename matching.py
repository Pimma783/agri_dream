"""Shared rules and fixtures for the F3 demo."""
import math

PILOT_PROVINCES = {"อุตรดิตถ์", "นครสวรรค์", "กำแพงเพชร"}
MATERIALS = {"ฟางข้าว", "ซังข้าวโพด", "ใบอ้อย"}
MAX_DISTANCE_KM = 80

# Fictional buyers and route distances for the demo.
BUYERS = {
    "B01": ("โรงงานตัวอย่าง A", "ฟางข้าว", 1, True, 950, {"นครสวรรค์": 35, "กำแพงเพชร": 80}),
    "B02": ("โรงงานตัวอย่าง B", "ฟางข้าว", 2, True, 1100, {"นครสวรรค์": 80, "กำแพงเพชร": 42}),
    "B03": ("โรงงานตัวอย่าง C", "ฟางข้าว", 1, True, 1250, {"นครสวรรค์": 80.1, "กำแพงเพชร": 85}),
    "B04": ("โรงงานตัวอย่าง D", "ซังข้าวโพด", 1, True, 850, {"อุตรดิตถ์": 28}),
    "B05": ("โรงงานตัวอย่าง E", "ใบอ้อย", 3, True, 750, {"กำแพงเพชร": 30}),
    "B06": ("โรงงานตัวอย่าง F", "ฟางข้าว", 1, False, 1200, {"นครสวรรค์": 20}),
}

def find_biomass_buyers(material: str, quantity_tons: float, province: str) -> dict:
    """Find eligible fictional biomass buyers within 80 km, sorted by price then distance.

    Args:
        material: Canonical material name: ฟางข้าว, ซังข้าวโพด, or ใบอ้อย.
        quantity_tons: Available biomass in metric tons, strictly greater than zero.
        province: Pickup province: อุตรดิตถ์, นครสวรรค์, or กำแพงเพชร.
    """
    errors = {}
    if material not in MATERIALS:
        errors["material"] = "เลือก ฟางข้าว ซังข้าวโพด หรือใบอ้อย"
    if not math.isfinite(quantity_tons) or quantity_tons <= 0:
        errors["quantity_tons"] = "ระบุปริมาณเป็นตันที่มากกว่าศูนย์"
    if province not in PILOT_PROVINCES:
        errors["province"] = "เลือก อุตรดิตถ์ นครสวรรค์ หรือกำแพงเพชร"
    if errors:
        return {"errors": errors}

    matches = []
    for buyer_id, (name, accepted, minimum, open_for_buying, price, routes) in BUYERS.items():
        distance = routes.get(province)
        if (
            open_for_buying
            and material == accepted
            and quantity_tons >= minimum
            and distance is not None
            and distance <= MAX_DISTANCE_KM
        ):
            matches.append({
                "buyer_id": buyer_id,
                "name": name,
                "distance_km": distance,
                "simulated_price_thb_per_ton": price,
            })
    matches.sort(key=lambda row: (
        -row["simulated_price_thb_per_ton"], row["distance_km"], row["buyer_id"]
    ))
    return {"quantity_tons": quantity_tons, "matches": matches}

