/**
 *  Copyright (c) 2015, The Regents of the University of California,
 *  through Lawrence Berkeley National Laboratory (subject to receipt
 *  of any required approvals from the U.S. Dept. of Energy).
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree.
 */

import React from "react";
import Markdown from "react-markdown";
import Highlighter from "./Highlighter";
import text from "raw!../docs/TimeSeries.md";

export default React.createClass({

    mixins: [Highlighter],

    render() {
        return (
            <div>
                <div className="row">
                    <div className="col-md-12">
                        <Markdown source={text}/>
                    </div>
                </div>
            </div>
        );
    }
});
