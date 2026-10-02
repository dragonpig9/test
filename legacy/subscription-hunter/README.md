# Subscription Hunter

Fintech hackathon starter. Finds forgotten recurring charges in a list of transactions and shows how much you'd save by cancelling them.

## Run it
Open `index.html` in your browser. No install needed.
Click **Load sample data**, or upload your own CSV (`date,merchant,amount`, see `sample-transactions.csv`).

## How it works
1. Group transactions by merchant.
2. Keep merchants with 3+ charges at a regular gap (weekly, monthly, yearly).
3. Drop merchants whose amounts vary a lot (groceries, food delivery).
4. Flag price increases, total the monthly cost, and calculate savings.

The logic is in `findSubscriptions()` in `index.html`.

## Ideas to extend
- Real bank data through a sandbox API (Plaid, GoCardless)
- Email or notification before a free trial ends
- AI summary of "what to cancel and why"
- Shared view for flatmates

## Team
- Kelvin
- (add names here)
