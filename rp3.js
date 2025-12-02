var randomRelatedIndex, showRelatedPost;
(function(n, m, k) {
    var d = {
        widgetStyle: 1,
        homePage: "http://www.dte.web.id",
        numPosts: 7,
        summaryLength: 370,
        titleLength: "auto",
        thumbnailWidth: 200,
        thumbnailHeight: 113,
        noImage: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiIHhtbG5zOnY9Imh0dHBzOi8vdmVjdGEuaW8vbmFubyI+PHBhdGggZD0iTTAgMGgxdjFIMHoiIGZpbGw9IiNmNmY4ZmMiLz48L3N2Zz4=",
        containerId: "related-post",
        newTabLink: false,
        moreText: "Baca Selengkapnya",
        callBack: function() {}
    };
    for (var f in relatedPostConfig) {
        d[f] = (relatedPostConfig[f] == "undefined") ? d[f] : relatedPostConfig[f]
    }
    var j = function(a) {
        var b = m.createElement("script");
        b.type = "text/javascript";
        b.src = a;
        k.appendChild(b)
    }
      , o = function(b, a) {
        return Math.floor(Math.random() * (a - b + 1)) + b
    }
      , l = function(a) {
        var p = a.length, c, b;
        if (p === 0) {
            return false
        }
        while (--p) {
            c = Math.floor(Math.random() * (p + 1));
            b = a[p];
            a[p] = a[c];
            a[c] = b
        }
        return a
    }
      , e = (typeof labelArray == "object" && labelArray.length > 0) ? "/-/" + l(labelArray)[0] : ""
      , h = function(b) {
        var c = b.feed.openSearch$totalResults.$t - d.numPosts
          , a = o(1, (c > 0 ? c : 1));
        j(d.homePage.replace(/\/?\?m=\d+(\&|$)|\/+$|\/\?.*$/, "") + "/feeds/posts/summary" + e + "?alt=json-in-script&orderby=updated&start-index=" + a + "&max-results=" + d.numPosts + "&callback=showRelatedPost")
    }
      , g = function(z) {
        var s = document.getElementById(d.containerId), x = l(z.feed.entry), A = d.widgetStyle, c = '<ul class="clear related-post-style-' + A + '">', b = d.newTabLink ? ' target="_blank"' : "", y = '<span style="display:block;clear:both;"></span>', v, t, w, r, u;
        if (!s) {
            return
        }
        for (var q = 0; q < d.numPosts; q++) {
            if (q == x.length) {
                break
            }
            t = x[q].title.$t;
            w = (d.titleLength !== "auto" && d.titleLength < t.length) ? t.substring(0, d.titleLength) + "&hellip;" : t;
            r = ("media$thumbnail"in x[q] && d.thumbnailWidth !== false) ? x[q].media$thumbnail.url.replace(/\/[sw]\d+[^\/]*/, "/w" + d.thumbnailWidth + "-h" + d.thumbnailHeight + "-p-rw") : d.noImage;
			rbk = ("media$thumbnail"in x[q] && d.thumbnailWidth !== false) ? x[q].media$thumbnail.url.replace(/\/[sw]\d+[^\/]*/, "/w48-h48-p-rw") : d.noImage;
            u = ("summary"in x[q] && d.summaryLength > 0) ? x[q].summary.$t.replace(/<br ?\/?>/g, " ").replace(/<.*?>/g, "").replace(/[<>]/g, "").substring(0, d.summaryLength) + "&hellip;" : "";
            for (var p = 0, a = x[q].link.length; p < a; p++) {
                v = (x[q].link[p].rel == "alternate") ? x[q].link[p].href : "#"
            }
            if (A == 2) {
                c += '<li class="related-post-item" tabindex="0"><a class="related-post-item-titleimg" href="' + v + '"' + b + ' title="' + t + '"><img alt="' + t + '" class="related-post-item-thumbnail lazyload" src="'+d.noImage+'" data-src="' + r + '" width="' + d.thumbnailWidth + '" height="' + d.thumbnailHeight + '" title="' + t + '"></a><button class="bookmark-button" data-img="' + rbk + '" data-title="' + t + '" data-url="' + v + '">Loading...</button><h3 class="related-post-item-tooltip"><a class="related-post-item-title" title="' + t + '" href="' + v + '"' + b + ">" + w + "</a></h3>" + y + "</li>"
            } else {
                c += '<li><a title="' + t + '" href="' + v + '"' + b + ">" + w + "</a></li>"
            }
        }
        s.innerHTML = c += "</ul>" + y;
        d.callBack();
    };
    randomRelatedIndex = h;
    showRelatedPost = g;
    j(d.homePage.replace(/\/?\?m=\d+(\&|$)|\/+$|\/\?.*$/, "") + "/feeds/posts/summary" + e + "?alt=json-in-script&orderby=updated&max-results=0&callback=randomRelatedIndex");
}
)(window, document, document.getElementsByTagName("head")[0]);
