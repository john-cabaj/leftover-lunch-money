<img width="309" height="90" alt="powered-by-lunch-money-badge" src="https://github.com/user-attachments/assets/eff31e9e-8e34-4cc0-86b1-1cd9cd230dcf" />


Disclaimer: based on the great widget from @aryascripts, subsequently forked from @berndsalewski as well.

# Lunch Money Widget
<img width="806" height="374" alt="IMG_0096" src="https://github.com/user-attachments/assets/88213b0d-c2d9-4e60-b608-69e432cdc5a3" />

An iOS Widget for Leftover Lunch Money status, along with a short list of unreviewed transactions.

One of my favorite features from a previous budgeting app was the ability to get a true sense of what money I had left to spend or save by the end of the month. Lunch Money makes this easy to calculate, and even better, gives us the tools to pull the data from the [Lunch Money API](https://lunchmoney.dev/introduction). This data is key for how I budget, so I whipped something up to get me the figure I was after.

I also thought it would be helpful to see a list of unreviewed transactions, as those are generally the newest ones coming in. This information plus the Leftover tracker helps me keep on top of my budget in close to real-time. An additional helpful feature is that the widget can show the previous period or the current period - so I've set up a iOS Widget stack of one widget showing the previous month, and one showing the current month.

Tapping the widget will open Lunch Money at the Transactions page.

## How to Use

1. Download [Scriptable](https://scriptable.app)
2. Add new script
3. Copy and paste the contents of [index.js](https://raw.githubusercontent.com/john-cabaj/leftover-lunch-money/refs/tags/v1/index.js) and save
4. Tap and hold on the script name, select rename, name the script "Leftover Lunch Money"

   NOTE: This is not required for functionality, but describes the script for ease of use
6. Run the script, this will pop up an alert box
7. Paste your [API key from Lunch Money](https://my.lunchmoney.app/developers)
8. The API key will be stored in Scriptable's on-device Keychain, and shouldn't need to be entered again
9. Add a new widget to the home screen
10. Select a widget size, all sizes are supported
11. Tap and hold the new widget, select "Edit Widget"
12. Select Leftover Lunch Money from the list and select options as you see fit ("previous" = previous period, "current" or otherwise = current period):
    
   <img width="400" height="400" alt="options" src="https://github.com/user-attachments/assets/2fca5093-1e4f-48e8-83f6-83ab746a94f6" />
  
12. Once options are set, tap on the home screen (not the widget options) to save the changes
13. Enjoy!

## Other images
### Large
<img width="539" height="539" alt="IMG_0099" src="https://github.com/user-attachments/assets/1754c7a4-34a2-4517-be4d-ce0010e75abd" />

### Small
<img width="253" height="253" alt="IMG_0098" src="https://github.com/user-attachments/assets/09b29b03-8d4a-4045-a093-5cdc4e891689" />

### Medium
<img width="537" height="249" alt="IMG_0096" src="https://github.com/user-attachments/assets/00a5b9ab-4013-4764-9212-282599ea3442" />

## Privacy
Cached data (unreviewed transactions and inflow/outflow/leftover information) and diagnostics data are stored in Scriptable's Documents directory.
