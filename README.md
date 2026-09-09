<img width="309" height="90" alt="powered-by-lunch-money-badge" src="https://github.com/user-attachments/assets/eff31e9e-8e34-4cc0-86b1-1cd9cd230dcf" />


Disclaimer: based on the great widget from @aryascripts, subsequently forked from @berndsalewski as well.

# Lunch Money Widget
<img width="806" height="374" alt="IMG_0113" src="https://github.com/user-attachments/assets/15848212-929c-43d1-ab0c-268f44b6366c" />

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
<img width="539" height="539" alt="IMG_0112" src="https://github.com/user-attachments/assets/4a223323-6b3f-4c43-9d42-08f1a8e8e257" />

### Small
<img width="253" height="253" alt="IMG_0115" src="https://github.com/user-attachments/assets/81b10238-37d9-4f2c-a2a0-9e977df6e036" />

### Medium
<img width="537" height="249" alt="IMG_0113" src="https://github.com/user-attachments/assets/281cae29-c497-4ed1-a7ef-1be63a68857c" />

## Privacy
Cached data (unreviewed transactions and inflow/outflow/leftover information) and diagnostics data are stored in Scriptable's Documents directory.
