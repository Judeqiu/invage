[![Quantpedia logo](https://quantpedia.com/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Flogo.0c8sjr~0-da90.png&w=640&q=75)](https://quantpedia.com/) Open main menu

[Pricing](https://quantpedia.com/pricing) [Product](https://quantpedia.com/screener) [How It Works](https://quantpedia.com/how-it-works) [About](https://quantpedia.com/quantpedia-mission) [Blog](https://quantpedia.com/blog) [Resources](https://quantpedia.com/resources) [Consulting](https://quantpedia.com/quant-consulting-services) [Awards](https://quantpedia.com/awards)

[Screener](https://quantpedia.com/screener) [Charts](https://quantpedia.com/charts) [Portfolio Analysis](https://quantpedia.com/portfolio-analysis) [Live Strategies](https://quantpedia.com/live-strategies) [Market Overview](https://quantpedia.com/market-overview) [Dashboard](https://quantpedia.com/dashboard)

[Sign Up](https://quantpedia.com/pricing) Log in

[Back to Screener](https://quantpedia.com/screener)

# Post-Earnings Announcement Effect

Bookmark

Share

[delete](https://www.linkedin.com/shareArticle?mini=true&url=https%3A%2F%2Fquantpedia.com%2Fstrategies%2Fpost-earnings-announcement-effect)[delete](https://twitter.com/intent/tweet?text=Post-Earnings%20Announcement%20Effect%20https%3A%2F%2Fquantpedia.com%2Fstrategies%2Fpost-earnings-announcement-effect)[delete](https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fquantpedia.com%2Fstrategies%2Fpost-earnings-announcement-effect)[delete](mailto:?to=&subject=Post-Earnings%20Announcement%20Effect&body=Post-Earnings%20Announcement%20Effect%20https%3A%2F%2Fquantpedia.com%2Fstrategies%2Fpost-earnings-announcement-effect)

### Quantpedia is The Encyclopedia of Quantitative Trading Strategies

We've already analyzed tens of thousands of financial research papers and identified more than1000 attractive trading systems together with thundreds of related academic papers.

[Browse Strategies](https://quantpedia.com/screener)

- Unlock Screener & 300+ Advanced Charts
- Browse 1000+ uncommon trading strategy ideas
- Get new strategies on bi-weekly basis
- Explore 2000+ academic research papers
- View 800+ out-of-sample backtests
- Design multi-factor multi-asset portfolios

[Get subscription](https://quantpedia.com/pricing)

Post-earnings announcement drift or PEAD is the tendency for a stock’s cumulative abnormal returns to drift for several weeks (even several months) following the positive earnings announcement. It is an academically well-documented anomaly first discovered by Ball and Brown in 1968 (we present links to several related academic research papers). Since then, it has been studied and confirmed by countless academics in many international markets. There are a number of ways to define an earnings surprise (or ways to filter stocks with the positive response to earnings) - earnings higher than analysts estimates, earnings higher than some average earnings or stock’s [price appreciation during earnings announcement](https://quantpedia.com/strategies/reversal-during-earnings-announcements/) period higher than expected. Each factor shows a strong prediction ability for the stock’s future returns, and it is good to use some combination of factors to enhance the PEAD effect.

We present one such strategy from the source paper related to this anomaly. This strategy is presented in its long-short form, but most of the returns come from the long side, so it is not a problem to implement it as long-only. Research also shows that the main performance contributors are [small-capitalization stocks](https://quantpedia.com/strategies/small-capitalization-stocks-premium-anomaly/); therefore, caution is recommended during the strategy’s implementation.

## Fundamental reason

This phenomenon can be explained with several hypotheses. The most widely accepted explanation for this effect is investors' [under-reaction to earnings announcements](https://quantpedia.com/strategies/reversal-in-post-earnings-announcement-drift/). It is also widely believed that there is a strong connection between earnings momentum and price momentum.

Several studies also show earnings momentum could be explained by liquidity risk as the Post-Earnings Announcement Effect appears to be strong in small-cap stocks.

## Get Premium Strategy Ideas & Pro Reporting

- Unlock Screener & 300+ Advanced Charts
- Browse 1000+ unique strategies
- Get new strategies on bi-weekly basis
- Explore 2000+ academic research papers
- View 800+ out-of-sample backtests
- Design multi-factor multi-asset portfolios

[Get subscription](https://quantpedia.com/pricing)

## Keywords

[stock picking](https://quantpedia.com/strategy-tags/stock-picking) [equity long short](https://quantpedia.com/strategy-tags/equity-long-short) [fundamental analysis](https://quantpedia.com/strategy-tags/fundamental-analysis) [earnings announcement](https://quantpedia.com/strategy-tags/earnings-announcement) [factor investing](https://quantpedia.com/strategy-tags/factor-investing) [smart beta](https://quantpedia.com/strategy-tags/smart-beta)

#### Market Factors

Equities

#### Confidence in Anomaly's Validity

Strong

#### Period of Rebalancing

Quarterly

#### Number of Traded Instruments

1000

#### Notes to Number of Traded Instruments

more or less, it depends on investor's need for diversification

#### Complexity Evaluation

Complex

#### Financial instruments

Stocks

#### Backtest period from source paper

1987 – 2004

#### Indicative Performance

15%

#### Notes to Indicative Performance

per annum, strategy’s performance calculated as annualized (geometrically) 60 days return (2.97%-(-0.58%)) for long-short portfolio from table 7.

#### Notes to Estimated Volatility

not stated

#### Maximum Drawdown

-11.2%

#### Notes to Maximum drawdown

not stated

#### Regions

United States

## Simple trading strategy

The investment universe consists of all stocks from NYSE, AMEX, and NASDAQ except financial and utility firms and stocks with prices less than $5. Two factors are used: EAR (Earnings Announcement Return) and SUE (Standardized Unexpected Earnings). SUE is constructed by dividing the earnings surprise (calculated as actual earnings minus expected earnings; expected earnings are computed using a seasonal random walk model with drift) by the standard deviation of earnings surprises. EAR is the abnormal return for firms recorded over a three-day window centered on the last announcement date, in excess of the return of a portfolio of firms with similar risk exposures.

Stocks are sorted into quintiles based on the EAR and SUE. To avoid look-ahead bias, data from the previous quarter are used to sort stocks. Stocks are weighted equally in each quintile. The investor goes long stocks from the intersection of top SUE and EAR quintiles and goes short stocks from the intersection of the bottom SUE and EAR quintiles the second day after the actual earnings announcement and holds the portfolio one quarter (or 60 working days). The portfolio is rebalanced every quarter.

Edit: We use long-only implementation of PEAD strategy, as research papers shows that the most of the return of this effect comes from the long side ...

## Hedge for stocks during bear markets

Unknown – Source and related research papers don't offer insight into the correlation structure of PEAD strategy to equity market risk; therefore, we do not know if this strategy can be used as a hedge/diversification during the time of market crisis. PEAD strategy is usually built as a long-short equity strategy, but it can be split into two parts. The long leg of the strategy is surely strongly correlated to the equity market; however, the short only leg can be maybe used as a hedge during bad times. Rigorous backtest is, however, needed to determine return/risk characteristics and correlation.

## Out-of-sample strategy implementation in QuantConnect (chart, statistics & code)

[iframe](https://www.quantconnect.cloud/backtest/f70478572dc20682d7f00d4712312c83)

## Related video

## Related picture

[![Post-Earnings Announcement Effect](https://quantpedia.com/next-api/images/screener/post-earnings-announcement-effect/image?pictureStamp=gWu1sGxJi63YW5X4n4rZiRUSG8Q=&w=3840&q=75)](https://quantpedia.com/next-api/images/screener/post-earnings-announcement-effect/image?pictureStamp=gWu1sGxJi63YW5X4n4rZiRUSG8Q=)

## Source paper

### Brandt, Kishore, Santa-Clara, Venkatachalam: Earnings Announcements are Full of Surprises

[http://docentes.fe.unl.pt/~psc/ear.pdf](http://docentes.fe.unl.pt/~psc/ear.pdf) [https://quantpedia.com/www/Earnings\_Announcements\_are\_Full\_of\_Surprises.pdf](https://quantpedia.com/www/Earnings_Announcements_are_Full_of_Surprises.pdf)

Abstract: We study the drift in returns of portfolios formed on the basis of the stock price reaction around earnings announcements. The Earnings Announcement Return (EAR) captures the market reaction to unexpected information contained in the company’s earnings release. Besides the actual earnings news, this includes unexpected information about sales, margins, investment, and other less tangible information communicated around the earnings announcement. A strategy that buys and sells companies sorted on EAR produces an average abnormal return of 7.55% per year, 1.3% more than a strategy based on the traditional measure of earnings surprise, SUE. The post earnings announcement drift for EAR strategy is stronger than post earnings announcement drift for SUE. More importantly, unlike SUE, the EAR strategy returns do not show a reversal after 3 quarters. The EAR and SUE strategies appear to be independent of each other. A strategy that exploits both pieces of information generates abnormal returns of about 12.5% on an annual basis.

## Other papers

- ### Chan, Jagadeesh, Lakonishok: Momentum strategies


[http://www.nber.org/papers/w5375.pdf](http://www.nber.org/papers/w5375.pdf)

Abstract: We relate the predictability of future returns from past returns to the market's underreaction to information, focusing on past earnings news. Past return and past earnings surprise each predict large drifts in future returns after controlling for the other. There is little evidence of subsequent reversals in the returns of stocks with high price and earnings momentum. Market risk, size and book-to- market effects do not explain the drifts. Security analysts' earnings forecasts also respond sluggishly to past news, especially in the case of stocks with the worst past performance. The results suggest a market that responds only gradually to new information.

- ### Liu, Strong, Xiu: Post-earnings-announcement Drift in the UK


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=249959](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=249959)

Abstract: This paper fills a void in the market efficiency literature by testing for the presence of post-earnings announcement drift in the non-US market. We test for drift using alternative earnings surprise measures based on: (i) the time-series of earnings; (ii) market prices; and (iii) analyst forecasts. Using each of the measures we find evidence of significant post-earnings-announcement drift, robust to alternative controls for risk and market microstructure effects. Using a one-dimensional analysis, the price-based measure of earnings surprise gives the strongest drift, and using a two-dimensional analysis the drift associated with the price-based measure almost subsumes drift associated with the other two measures. Our conclusion is that the UK stock market is inefficient with respect to publicly available corporate earnings information. This evidence provides out-of-sample confirmation of the post-earnings-announcement drift documented in the US.

- ### Sadka: Momentum and Post-Earnings-Announcement Drift Anomalies: The Role of Liquidity Risk


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=428160](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=428160)

Abstract: This paper investigates the components of liquidity risk that are important for asset-pricing anomalies. Firm-level liquidity is decomposed into variable and fixed price effects and estimated using intraday data for the period 1983-2001. Unexpected systematic (market-wide) variations of the variable component rather than the fixed component of liquidity are shown to be priced within the context of momentum and post-earnings-announcement drift (PEAD) portfolio returns. As the variable component is typically associated with private information (e.g., Kyle (1985)), the results suggest that a substantial part of momentum and PEAD returns can be viewed as compensation for the unexpected variations in the aggregate ratio of informed traders to noise traders.

- ### Garginkel, Sokobin: Volume, Opinion Divergence and Returns: A Study of Post-Earnings Announcement Drift


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=280913](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=280913)

Abstract: This paper examines the relationship between post-earnings announcement returns and different measures of volume at the earnings date. We find that post-event returns are strictly increasing in the component of volume that is unexplained by prior trading activity. We interpret unexplained volume as an indicator of opinion divergence among investors and conclude that post-event returns are increasing in ex-ante opinion divergence. Our evidence is consistent with Varian (1985) who suggests that opinion divergence may be treated as an additional risk factor affecting asset prices.

- ### Chordia, Shivakumar: Earnings and Price Momentum


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=342581&amp;rec=1&amp;srcabs=1087391](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=342581&amp;rec=1&amp;srcabs=1087391)

Abstract: This paper examines whether earnings momentum and price momentum are related. Both in time-series as well as in cross-sectional asset pricing tests, we find that price momentum is captured by the systematic component of earnings momentum. The predictive power of past returns is subsumed by a zero-investment portfolio that is long on stocks with high earnings surprises and short on stocks with low earnings surprises. Further, returns to the earnings-based zero-investment portfolio that is long on stocks with high earnings surprises. Further, returns to the earnings-based zero-investment portfolio are significantly related to future macroeconomic activities, including growth in GDP, industrial production, consumption, labor income, inflation, and T-bill returns. Our results have implications for the Carhart four-factor model and suggest that the price-momentum factor in the Carhart model is merely a noisy proxy for the earnings-momentum based hedge portfolio, PMN.

- ### Barbosa: Differential Interpretation of Information and the Post-Announcement Drift: A Story of Consensus Learning


[http://www.efmaefm.org/0EFMAMEETINGS/EFMA%20ANNUAL%20MEETINGS/2012-Barcelona/papers/EFMA2012\_0068\_fullpaper.pdf](http://www.efmaefm.org/0EFMAMEETINGS/EFMA%20ANNUAL%20MEETINGS/2012-Barcelona/papers/EFMA2012_0068_fullpaper.pdf)

Abstract: I show how a post-announcement drift can be generated in a model with fully rational investors who interpret public information differently. Differential interpretation of information transforms public raw information into private interpreted information. If investors recognize their limited ability to interpret information, they will look for other investors’ opinions in prices. Noise trading prevents investors from learning the market consensus interpretation of the announcement from the observation of a single price. But if noise trading follows a mean-reverting process, investors can gradually learn the market consensus from the observation of a series of prices. As investors become more confident about their interpretation of the announcement, they put more weight on it, and the announcement is gradually incorporated into prices, which generates a post-announcement drift. The model accounts for all salient empirical facts related to the post-announcement drift and delivers two new testable implications. If, in addition, investors make mistakes in extracting information from prices, the model also generates momentum.

- ### Dechow, Sloan, Zha: Stock Prices &amp; Earnings: A History of Research


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=2347193](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=2347193)

Abstract: Accounting earnings summarize periodic corporate financial performance and are a key determinant of stock prices. We review research on the usefulness of accounting earnings, including research on the link between accounting earnings and firm value and research on the usefulness of accounting earnings relative to other accounting and non-accounting information. We also review research on the features of accounting earnings that make it useful to investors, including the accrual accounting process, fair value accounting and the conservatism convention. We finish by summarizing research that identifies situations in which investors appear to misinterpret earnings and other accounting information leading to security mispricing.

- ### Barinov, Park, Yildizhan: Firm Complexity and Post-Earnings-Announcement Drift


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=2360338](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=2360338)

Abstract: The paper shows that the post-earnings-announcement drift is stronger for conglomerates, despite conglomerates being larger, more liquid, and more actively researched by investors. We attribute this finding to slower information processing about complex firms and show that the post-earnings-announcement drift is positively related to measures of conglomerate complexity. We also find that the post-earnings-announcement drift is stronger for new conglomerates than it is for existing conglomerates and that investors are most confused about complicated firms that expand from within rather than firms that diversify into new business segments via mergers and acquisitions.

- ### Alwathnani, Dubofsky: It's All Overreaction: The Post Earnings Announcement Drift


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=2420799](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=2420799)

Abstract: In this paper, we test whether the well-documented post-earnings-announcement drift is a manifestation of an investor overreaction to extremely good or bad earnings news rather than a market underreaction, as it is commonly interpreted. Using the market reaction to the extreme earnings surprises (i.e. SUE) in quarter Qt as a reference point, we show that firms reporting SUE in quarter Qt+1 that confirms their initial SUE rankings in the highest or lowest SUE quintiles for the second consecutive quarter generate an incremental price run that moves in the same direction as that of the initial SUE. However, the price impact of the confirming SUE signal is weaker than that of its initial SUE counterpart. On the other hand, firms reporting disconfirming SUE that fails these firms to keep (move out of) their positions in the top (bottom) SUE quintile experience a strong price reversal. Our findings are robust to the Fama-French three-factor daily regression extended by the momentum factor and a number of robustness tests. Evidence reported in this study is not consistent with prevailing view that investors underreact to earnings news. To the contrary, our finding suggests an investor overreaction to extreme SUE signals.

- ### Kwon, Kim: Investment Horizon of Shareholders and Post-Earnings-Announcement Drift


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=2545189](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=2545189)

Abstract: We hypothesize that post-earnings-announcement drift (PEAD) is caused by underreaction of long-term investors since they do not pay much attention to short-term events. Consistent with the hypothesis, empirical observations show that stocks mostly held by long-term investors exhibit strong PEAD, while stocks mostly held by short-term investors does not. The results are still robust even after transaction costs, investor recognition, temporal inattention, and reversal in earnings surprises are controlled for.

- ### Messias: Post Earnings Announcement Drift, a Price Signal?


[http://papers.ssrn.com/sol3/papers.cfm?abstract\_id=2612459](http://papers.ssrn.com/sol3/papers.cfm?abstract_id=2612459)

Abstract: This paper investigates the robustness of post-earnings-announcement-drift (PEAD) on a price signal perspective, unlike the traditional literature that focuses on fundamental signal. The studied period is 2003-2015, for four main US indices. The results suggest that some economic agents are too slow to integrate the information, although they still have a major market impact. We find a strong empirical evidence of the preeminence of this bias for Momentum stocks rather than blue-chips or non-Momentum small-caps. Even by challenging the strategy, the conclusion remains strong with abnormal returns linked to such market inefficiency, with better returns for positive signals than negative ones. We choose Nasdaq Composite as the backbone of our development as it is the closest index to Uncia’s field of expertise. For indices known as Momentum, we find strong predictability of the systematic net exposure, the latter being a consequence of the long and short positions implied by the earnings signals.

- ### Daniel, Hirschleifer, Sun: Short and Long Horizon Behavioral Factors


[https://papers.ssrn.com/sol3/papers.cfm?abstract\_id=3086063](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3086063)

Abstract: Recent theories suggest that both risk and mispricing are associated with commonality in security returns, and that the loadings on characteristic-based factors can be used to predict future returns. We offer a parsimonious model which features: (1) a factor motivated by limited attention that is dominant in explaining short-horizon anomalies, and (2) a factor motivated by overconfidence that is dominant in explaining long-horizon anomalies. Our three-factor risk-and-behavioral composite model outperforms both standard models and recent prominent factor models in explaining a large set of robust return anomalies.

- ### Kim, Kim: A Multi-factor Explanation of Post-Earnings-Announcement Drift


[https://papers.ssrn.com/sol3/papers.cfm?abstract\_id=3267792](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3267792)

Abstract: To explain post-earnings announcement drift, we construct a risk factor related to unexpected earnings surprise, and propose a four-factor model by adding this risk factor to Fama and French’s (1993), (1995) three-factor model. This earnings surprise risk factor provides a remarkable improvement in explaining post-earnings announcement drift when included in addition to the three factors of Fama and French. After adjusting raw returns for the four risk factors, the cumulative abnormal returns over the 60 trading days subsequent to quarterly earnings announcements are economically and statistically insignificant. Furthermore, except for the first two days after the earnings announcement, the cumulative abnormal returns and the arbitrage returns from our four-factor model are relatively stable over the testing period and never significant on any day of the testing period. On the other hand, the arbitrage returns from the other models increase over the 60-day testing period. We argue that most of the post-earnings announcement drift observed in prior studies may be a result of using misspecified models and failing to appropriately adjust raw returns for risk.

- ### Sojka: 50 Years in PEAD Research


[https://papers.ssrn.com/sol3/papers.cfm?abstract\_id=3281679](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3281679)

Abstract: Analysing earning’s predictive power on stock returns was in the heart of academic research since late 60’s. First introduced to academic world in 1967 during seminar “Analysis of Security Prices” by Chicago University Professors Ray Ball and Philip Brown. In the next four decades was extensively analysed by many academics and is now a well-documented anomaly and is referred to as Post Earnings Announcement Drift (PEAD). This phenomenon is still at the centre of academic research because it stands at odds with efficient market hypothesis which assumes that all information is instantaneously reflected in stock prices. Professional investors are also closely looking at PEAD as it implies that it is easy to beat the market average by simply ranking stocks based on their earnings surprise and investing in the top decile, quintile or quartile and shorting the bottom part. Academic evidence shows that this strategy produces an abnormal return of somewhere between 2.6% and 9.37% per quarter, according to various authors. In this paper I will present existing evidence supporting and contradicting “PEAD”, the history of academic research in that field and various techniques used to verify the phenomenon. The paper is organised as follows: first the history of the PEAD academic research is presented, in the second more recent evidence and research techniques used by authors are presented and finally conclusions and various critics of PEAD are shown.

- ### Correira, Barbosa: Can Post-Earnings Announcement Drift and Momentum Explain Reversal?


[https://papers.ssrn.com/sol3/papers.cfm?abstract\_id=3501161](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3501161)

Abstract: We study the interrelation among the post-earnings announcement drift (PEAD) and momentum short-term anomalies, and the reversal long-term anomaly. Some theories argue that PEAD and momentum are a consequence of underreaction to new information on the market. One theory in particular, suggests that this underreaction occurs because investors are unsure about their interpretations of the impact of new information on the fundamental price, and look for the market consensus interpretation for guidance. This learning process takes time, and until it is complete, prices do not fully incorporate the new information. Furthermore, the more difficult it is to interpret the new information, the more prices underreact to the new information arrival, and the longer it takes for them to fully incorporate this information. On the other hand, there are investors that rely too much on past performance (known as “trend chasers”). These investors, motivated by the short-term performance during the underreaction period, push prices beyond their fundamentals, resulting in an overreaction whose correction generates long-run reversal. And the more difficult it is to interpret new information, the more likely it is that trend chasers create overreaction, leading to stronger reversals in the future. Therefore, uncertainty about the interpretation of new information can potentially link today’s reversal to past momentum and PEAD. Our major goal is to test this hypothesis. For that, we use a multifactor risk-based model and NYSE-AMEX stock prices for the period starting at January 1975 to December 2010. Our main conclusion points for a statistical and economical relation between past PEAD and reversal. The higher the returns of the PEAD zero-investment portfolio two years ago, the higher the returns of the reversal zero-investment portfolio today.

- ### Campbell, John L. and Zheng, Xin and Zhou, Dexin: Number of Numbers: Does Quantitative Disclosure Reduce Uncertainty in Quarterly Earnings Conference Calls?


[https://ssrn.com/abstract=3775905](https://ssrn.com/abstract=3775905)

Abstract: Theoretical research argues that numbers convey more precise information than words. Based on this work, we hypothesize that when managers provide disclosure with a greater proportion of quantitative information in an earnings conference call, investor uncertainty around the call will be lower and, thus, short-window returns around the call will be higher. We offer three main findings. First, we find a positive association between the extent of hard information (i.e., numerical disclosure) in earnings conference calls and short-window stock returns around the call. This result suggests that investor uncertainty is lower when managers provide greater numerical disclosure. Second, we find that this positive association is larger when firms are smaller and have larger stock volatility or analyst forecast dispersion. These results suggest that the effect of numerical disclosure in reducing investor uncertainty is greater when the firm’s information environment is otherwise more uncertain. Finally, we find that this positive association is larger when firms issue a negative earnings surprise. This result suggests that the effect of numerical disclosure in reducing investor uncertainty is greater when the uncertainty of a firm’s performance is greater. Overall, our results suggest that investors react to the extent of hard information (i.e., numerical disclosure) in earnings conference calls.

- ### Akbas, Ferhat and Ay, Lezgin and Koch, Paul D., Leverage Constraints, Arbitrage Capital, and Investor Under-reaction


[https://ssrn.com/abstract=3792433](https://ssrn.com/abstract=3792433)

Abstract: We analyze a hand-collected sample of earnings announcements over the period, 1934 – 1975, when the Fed changed margin requirements 22 times. We find that higher margin requirements are associated with greater under-reaction to earnings surprises. These results are stronger when investors face greater arbitrage risk or limited attention. They are robust when we control for macroeconomic conditions, financial market conditions, sentiment, or risk, and when we analyze several indirect measures of leverage constraints using more recent data. Our findings suggest that leverage constraints limit capital available to arbitrageurs, and thereby prevent the timely incorporation of earnings information into prices.

- ### Beyer, Anne and Smith, Kevin, Learning about Risk-Factor Exposures from Earnings: Implications for Asset Pricing and Manipulation


[https://ssrn.com/abstract=3800379](https://ssrn.com/abstract=3800379)

Abstract: When valuing a firm, investors must assess not only its expected future cash flows but also the systematic risk inherent in these cash flows. In this paper, we model the process by which investors may learn about firms' betas from earnings and how this learning process affects the relationship between earnings, announcement returns, and expected future returns. The model's main predictions are: (i) earnings response coefficients vary with macroeconomic conditions and are lower in upswings than downturns; (ii) earnings positively and negatively predict future returns in economic upswings and downturns, respectively, leading to return autocorrelation; and (iii) real earnings management rises in economic downturns and contributes to systematic risk in the economy. These predictions are directly attributable to investors' uncertainty regarding firms' exposures to systematic risk.

- ### Hirshleifer, David A. and Hirshleifer, David A. and Peng, Lin and Wang, Qiguang: Social Networks and Market Reactions to Earnings News


[https://ssrn.com/abstract=3824022](https://ssrn.com/abstract=3824022)

Abstract: Using social network data from Facebook, we show that earnings announcements made by firms located in counties with higher investor social network centrality attract more attention from both retail and institutional investors. For such firms, the immediate price and volume reactions to earnings announcements are stronger, and post-announcement drift is weaker. Such firms have lower post-announcement persistence of return volatility but higher persistence in investor attention and trading volume. These effects are stronger for small firms, firms with poor analyst and media coverage, and for stocks with salient returns. Our evidence suggests a dual role of social networks---they facilitate the incorporation of public information into prices, but also trigger persistent excessive trading.

- ### Friedman, Henry L. and Zeng, Zitong: Retail Investor Trading and Market Reactions to Earnings Announcements


[https://ssrn.com/abstract=3817979](https://ssrn.com/abstract=3817979)

Abstract: This paper uses holdings and outage data from Robinhood and transaction-level data from U.S. exchanges to examine how retail investors affect the pricing of public earnings information. We find that retail trader activity is associated with prices that are more responsive to earnings surprises, and earnings announcements affected by seemingly random retail trading outages experience weaker price responses. These results are concentrated in firms that are smaller and have less robust informational environments. Additional evidence shows that the retail activity is associated with more volatile returns during the earnings announcement window, which can slow the incorporation of public information and contribute to larger bid-ask spreads. Overall, our results suggest that retail investors can facilitate the incorporation of public information into price over the 2-day earnings announcement window despite the potential to increase volatility and impose risk on other market participants.

- ### Xu, Zhiwei and Yang, Yinan: Differences of Opinion, Overpricing and Market Underreaction to Earnings Announcements


[https://ssrn.com/abstract=4341969](https://ssrn.com/abstract=4341969)

Abstract: Prior studies find an insignificantly association between differences of opinion (DO) before earnings announcements (EAs) and the returns around the EAs and thereby reject the resale option theory that DO drives overpricing. We posit two issues that may lead to their conclusion to be one-sided. First, these studies used noisy DO proxies that are confounded by adverse selection. Second, DO and the resulting overpricing may not be largely reduced by the immediate EAs because of investors’ underreaction to the EA news. With a less noisy DO measure (DIFOPN), we verify the insignificant association between pre-EA DO and the EA returns. More importantly, we also find a significantly negative (positive) association between pre-EA DIFOPN and post-EA returns (contemporaneous returns), suggesting that pre-EA DO indeed results in overpricing, which gets corrected with a delay. We further confirm that stocks with higher pre-EA DO suffer greater underreaction to the immediate EAs.

- ### Kim, Dongcheol and Roh, Tai-Yong and Min, Byoung-Kyu and Lee, Deok-Hyeon: Post-Earnings-Announcement Drift: Expected Growth Risk or Limits-to-Arbitrage?


[https://ssrn.com/abstract=6459829](https://ssrn.com/abstract=6459829)

Abstract: To explain post-earnings-announcement drift (PEAD), we propose expected growth risk, measured as covariance between stock returns and expected future real GDP growth rates. We find that both expected growth rates and expected growth risk increase with standardized unexpected earnings, and that expected growth risk is significantly priced in the cross-section of returns. A model incorporating expected growth risk alone explains PEAD well. Moreover, after controlling for expected growth risk, the previously documented relation between PEAD and limits-to-arbitrage disappears. These results suggest that the empirical evidence supporting the mispricing hypothesis attributed to limits-to-arbitrage is a consequence of a failure to incorporate appropriate risk, and that the drift is a manifestation of expected growth risk.

- ### Duggaraju, Bharadwaj: Impact of Earnings Surprises on Short-Term Asset Price Momentum


[https://ssrn.com/abstract=6174938](https://ssrn.com/abstract=6174938)

Abstract: Earnings surprises, which are instances where a company's reported earnings deviate from consensus analyst expectations, are among the most potent catalysts for short-term asset price movements in equity markets. This report provides a comprehensive, evidence-based analysis of how positive and negative earnings surprises affect stock prices in the days immediately following earnings announcements. Drawing on classic and contemporary academic literature, recent empirical data (including 2024-2026 market evidence), and sectoral and firmsize heterogeneity, the report explores the mechanisms underlying post-announcement price momentum, including investor underreaction, information diffusion, and behavioral biases. Methodological approaches such as event studies, regression models, and portfolio tests are discussed in detail, alongside the latest advances in measuring earnings surprises. The report also examines the role of market conditions, sectoral dynamics, and firm characteristics in shaping the magnitude and persistence of post-earnings momentum. Policy implications, practical trading strategies, and avenues for future research are addressed, providing a holistic view of this enduring market anomaly.


Share

[delete](https://www.linkedin.com/shareArticle?mini=true&url=https%3A%2F%2Fquantpedia.com%2Fstrategies%2Fpost-earnings-announcement-effect)[delete](https://twitter.com/intent/tweet?text=Post-Earnings%20Announcement%20Effect%20https%3A%2F%2Fquantpedia.com%2Fstrategies%2Fpost-earnings-announcement-effect)[delete](https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fquantpedia.com%2Fstrategies%2Fpost-earnings-announcement-effect)[delete](mailto:?to=&subject=Post-Earnings%20Announcement%20Effect&body=Post-Earnings%20Announcement%20Effect%20https%3A%2F%2Fquantpedia.com%2Fstrategies%2Fpost-earnings-announcement-effect)

* * *

### Browse Next Strategies

- [Pre-Holiday Effect](https://quantpedia.com/strategies/pre-holiday-effect)
- [Momentum Factor Effect in Country Equity Indexes](https://quantpedia.com/strategies/momentum-factor-effect-in-country-equity-indexes)
- [Combining Fundamental FSCORE and Equity Short-Term Reversals](https://quantpedia.com/strategies/combining-fundamental-fscore-and-equity-short-term-reversals)
- [Momentum Factor and Style Rotation Effect](https://quantpedia.com/strategies/momentum-factor-and-style-rotation-effect)
- [January Effect in Stocks](https://quantpedia.com/strategies/january-effect-in-stocks)
- [Momentum Factor Effect in Stocks](https://quantpedia.com/strategies/momentum-factor-effect-in-stocks)

[iframe](https://quantpedia.com/newsletter)

![Quantpedia logo](https://quantpedia.com/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Flogo.0c8sjr~0-da90.png&w=640&q=75)

The Encyclopedia of Quantitative Trading Strategies

##### Product

- [Pricing](https://quantpedia.com/pricing)
- [Screener](https://quantpedia.com/screener)
- [Charts](https://quantpedia.com/charts)
- [Consulting](https://quantpedia.com/quant-consulting-services)
- [Quantpedia Awards](https://quantpedia.com/quantpedia-awards-2024)

##### About Us

- [About Us](https://quantpedia.com/quantpedia-mission)
- [How it works](https://quantpedia.com/how-it-works)
- [Clients & References](https://quantpedia.com/references)
- [FAQ](https://quantpedia.com/how-it-works/faq)
- [Blog](https://quantpedia.com/blog)

##### Support

- [Contact](https://quantpedia.com/contact)
- [Privacy Policy](https://quantpedia.com/privacy-policy)
- [Terms of Service](https://quantpedia.com/terms-of-service)
- [Affiliate](https://quantpedia.com/affiliate)
- [Links & Tools](https://quantpedia.com/links-tools)

##### Follow Us

Risk Disclosure: Futures and forex trading contains substantial risk and is not for every investor. An investor could potentially lose all or more than the initial investment. Risk capital is money that can be lost without jeopardizing ones' financial security or life style. Only risk capital should be used for trading and only those with sufficient risk capital should consider trading. Past performance is not necessarily indicative of future results.

Hypothetical Performance Disclosure: Hypothetical performance results have many inherent limitations, some of which are described below. No representation is being made that any account will or is likely to achieve profits or losses similar to those shown; in fact, there are frequently sharp differences between hypothetical performance results and the actual results subsequently achieved by any particular trading program. One of the limitations of hypothetical performance results is that they are generally prepared with the benefit of hindsight. In addition, hypothetical trading does not involve financial risk, and no hypothetical trading record can completely account for the impact of financial risk of actual trading. for example, the ability to withstand losses or to adhere to a particular trading program in spite of trading losses are material points which can also adversely affect actual trading results. There are numerous other factors related to the markets in general or to the implementation of any specific trading program which cannot be fully accounted for in the preparation of hypothetical performance results and all which can adversely affect trading results.

Testimonial Disclosure: Testimonials appearing on this website may not be representative of other clients or customers and is not a guarantee of future performance or success.

© 2026 Quantpedia.com. All rights reserved.

We are using cookies to give you the best experience on our website. To learn more, see our [Privacy Policy](https://quantpedia.com/privacy-policy)

Accept