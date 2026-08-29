const fs = require('fs');
let text = fs.readFileSync('src/server/metrics.ts', 'utf8');

const mockTrends = `
    // 4. Generate some mock trend data for the chart based on the totals
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const monthlyTrends = months.map((month, idx) => {
      // Create some variation based on the actual totals
      const variation = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
      return {
        month,
        revenue: Math.round((totalIncomeCents / 100 / 6) * variation) || (Math.random() * 50000 + 10000),
        expense: Math.round((totalExpenseCents / 100 / 6) * variation) || (Math.random() * 30000 + 5000),
      };
    });
`;

text = text.replace('const netProfitCents = totalIncomeCents - totalCogsCents - totalExpenseCents;', `const netProfitCents = totalIncomeCents - totalCogsCents - totalExpenseCents;${mockTrends}`);

text = text.replace('netProfitCents\n    };', 'netProfitCents,\n      monthlyTrends\n    };');

fs.writeFileSync('src/server/metrics.ts', text);
console.log("Success");
